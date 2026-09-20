import { randomUUID } from "node:crypto";
import { requestJson, type RankedSite } from "@arca/core";
import { maskPhone, type CallRecord } from "@arca/db";
import type { Context } from "../context.js";
import { env } from "../env.js";
import { bus } from "../bus.js";
import { describeError } from "../logger.js";

/**
 * Outbound voice, through SLNG.
 *
 * Two rails sit in front of every call and neither can be talked around,
 * because the language model is not the thing that decides to dial:
 *
 *   1. The number must be on CALL_ALLOWLIST. Empty means no call is ever
 *      placed, which is the default.
 *   2. EXERCISE_MODE prefixes the call with "SIMULACRO" and is on by default.
 *
 * When a call cannot be placed, the failure is loud and the fallback is a
 * browser voice session with the same script. What never happens is a silent
 * success: a call that did not happen is reported as a call that did not happen.
 */

export interface CallScript {
  siteName: string;
  siteType: string;
  fireEtaMinutes: number | null;
  recommendedAction: string;
  registeredPeople: number | null;
  coordinatorCallback: string;
  exerciseMode: boolean;
  language: "es" | "ca" | "en";
}

export interface DispatchResult {
  call: CallRecord;
  mode: "phone" | "web";
  message: string;
}

interface SlngCallResponse {
  call_id: string;
  message?: string;
}

interface SlngWebSessionResponse {
  url?: string;
  session_url?: string;
  room_url?: string;
  token?: string;
  [key: string]: unknown;
}

interface SlngCallRecord {
  status?: string;
  transcript?: string | unknown;
  ended_at?: string;
  created_at?: string;
  answered_at?: string;
  [key: string]: unknown;
}

export class VoiceService {
  constructor(private readonly ctx: Context) {}

  get configured(): boolean {
    return Boolean(env.slng.apiKey && env.slng.agentId);
  }

  /**
   * Is this number one ARCA may dial?
   *
   * Exact match against E.164 after stripping spaces. No prefix matching and no
   * wildcards: an allowlist that can be satisfied by a prefix is not an
   * allowlist, and during a hackathon the only numbers on it are the team's own.
   */
  allowed(phone: string | null | undefined): boolean {
    if (!phone) return false;
    const normalised = phone.replace(/[\s-]/g, "");
    return env.safety.callAllowlist.some((entry) => entry.replace(/[\s-]/g, "") === normalised);
  }

  buildScript(site: RankedSite, language: CallScript["language"] = "es"): CallScript {
    return {
      siteName: site.name,
      siteType: site.subcategory.replace(/_/g, " "),
      fireEtaMinutes: site.arrivalMinutes,
      recommendedAction: describeAction(site.action, language),
      registeredPeople: site.capacity?.people ?? site.capacity?.places ?? null,
      coordinatorCallback: env.telegram.botUsername ? `@${env.telegram.botUsername}` : "the coordination centre",
      exerciseMode: env.safety.exerciseMode,
      language,
    };
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${env.slng.apiKey}`,
      "content-type": "application/json",
    };
  }

  /**
   * Place a call, or fall back to a browser session.
   *
   * Callers must already hold an approval: this function records and executes,
   * it does not decide. That separation is the whole safety model — there is no
   * code path from the language model to a ringing phone that does not pass
   * through a stored decision first.
   */
  async dispatch(input: {
    incidentId: string;
    site: RankedSite;
    script: CallScript;
    approvedBy: string;
  }): Promise<DispatchResult> {
    const phone = input.site.contacts?.phone?.[0] ?? null;
    const callId = randomUUID();
    const base: CallRecord = {
      id: callId,
      incidentId: input.incidentId,
      siteId: input.site.assetId,
      provider: "slng",
      providerCallId: null,
      phoneMasked: phone ? maskPhone(phone) : "no number on file",
      status: "dispatched",
      mode: "phone",
      dispatchedAt: new Date().toISOString(),
    };

    if (!this.configured) {
      return this.failed(base, "SLNG is not configured.");
    }

    // Everything that is not a permitted phone call becomes a browser session
    // with the identical script, rather than nothing.
    if (!phone) {
      return this.webSession(base, input, "No phone number on file for this site.");
    }
    if (!this.allowed(phone)) {
      return this.webSession(
        base,
        input,
        env.safety.callAllowlist.length === 0
          ? "CALL_ALLOWLIST is empty, so ARCA places no outbound calls."
          : "This number is not on the call allowlist.",
      );
    }

    try {
      const response = await requestJson<SlngCallResponse>(
        `${env.slng.agentsUrl}/v1/agents/${env.slng.agentId}/calls`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({
            phone_number: phone,
            arguments: toArguments(input.script),
          }),
          timeoutMs: 20_000,
          retries: 1,
        },
      );

      const call: CallRecord = { ...base, providerCallId: response.call_id, status: "dispatched" };
      await this.ctx.store.saveCall(call);
      await this.ctx.timeline(
        input.incidentId,
        "call_dispatched",
        `${input.script.exerciseMode ? "SIMULACRO: " : ""}Calling ${input.site.name} on ${call.phoneMasked}, approved by ${input.approvedBy}.`,
        { actor: input.approvedBy, data: { callId, providerCallId: response.call_id } },
      );
      bus.publish({ type: "call", incidentId: input.incidentId, callId, status: "dispatched" });

      void this.collect(callId).catch((error) =>
        this.ctx.log.error("Call collection failed", { callId, error: describeError(error) }),
      );

      return { call, mode: "phone", message: `Calling ${input.site.name} on ${call.phoneMasked}.` };
    } catch (error) {
      const message = describeError(error);
      this.ctx.log.error("SLNG dispatch failed", { error: message, incidentId: input.incidentId });
      return this.webSession(base, input, `Dialling failed: ${message}`);
    }
  }

  /**
   * A browser voice session with the same agent and the same script.
   *
   * This is the failsafe that keeps the workflow whole when telephony is
   * unavailable — the conversation still happens, is still transcribed and
   * still re-ranks the list. The record says `web` so nobody later mistakes it
   * for a phone call that reached the site.
   */
  private async webSession(
    base: CallRecord,
    input: { incidentId: string; site: RankedSite; script: CallScript; approvedBy: string },
    reason: string,
  ): Promise<DispatchResult> {
    if (!this.configured) return this.failed(base, reason);

    try {
      const response = await requestJson<SlngWebSessionResponse>(
        `${env.slng.agentsUrl}/v1/agents/${env.slng.agentId}/web-sessions`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ arguments: toArguments(input.script) }),
          timeoutMs: 20_000,
          retries: 1,
        },
      );

      const url = response.url ?? response.session_url ?? response.room_url ?? null;
      const call: CallRecord = {
        ...base,
        status: "web_session",
        mode: "web",
        webSessionUrl: url,
        error: reason,
      };
      await this.ctx.store.saveCall(call);
      await this.ctx.timeline(
        input.incidentId,
        "call_dispatched",
        `${reason} Opened a browser voice session for ${input.site.name} instead.`,
        { actor: input.approvedBy, data: { callId: base.id, url } },
      );
      bus.publish({ type: "call", incidentId: input.incidentId, callId: base.id, status: "web_session" });
      return {
        call,
        mode: "web",
        message: `${reason} A browser voice session is open instead${url ? `: ${url}` : ""}.`,
      };
    } catch (error) {
      return this.failed(base, `${reason} A browser session could not be opened either: ${describeError(error)}`);
    }
  }

  private async failed(base: CallRecord, reason: string): Promise<DispatchResult> {
    const call: CallRecord = { ...base, status: "failed", error: reason, endedAt: new Date().toISOString() };
    await this.ctx.store.saveCall(call);
    await this.ctx.timeline(base.incidentId, "call_failed", `No call was placed. ${reason}`, {
      data: { callId: base.id },
    });
    bus.publish({ type: "call", incidentId: base.incidentId, callId: base.id, status: "failed" });
    return { call, mode: "phone", message: `No call was placed. ${reason}` };
  }

  /** Poll a dispatched call until it ends, then store the transcript. */
  async collect(callId: string, options: { maxWaitMs?: number } = {}): Promise<CallRecord | null> {
    const maxWaitMs = options.maxWaitMs ?? 10 * 60_000;
    const startedAt = Date.now();

    for (;;) {
      const call = await this.ctx.store.getCall(callId);
      if (!call?.providerCallId) return call;
      if (call.status === "completed" || call.status === "failed") return call;

      if (Date.now() - startedAt > maxWaitMs) {
        await this.ctx.store.updateCall(callId, {
          status: "failed",
          error: "ARCA stopped waiting for this call to end.",
          endedAt: new Date().toISOString(),
        });
        return this.ctx.store.getCall(callId);
      }

      await new Promise((resolve) => setTimeout(resolve, 5_000));

      try {
        const record = await requestJson<SlngCallRecord>(
          `${env.slng.agentsUrl}/v1/agents/${env.slng.agentId}/calls/${call.providerCallId}`,
          { headers: this.headers(), timeoutMs: 15_000, retries: 1 },
        );

        const status = String(record.status ?? "").toLowerCase();
        const transcript = normaliseTranscript(record.transcript);
        const ended = ["completed", "ended", "finished", "failed", "no_answer", "busy"].includes(status);

        if (ended) {
          await this.ctx.store.updateCall(callId, {
            status: status === "completed" || status === "ended" || status === "finished" ? "completed" : "failed",
            transcript,
            endedAt: record.ended_at ?? new Date().toISOString(),
            latency: {
              dispatchedAt: call.dispatchedAt,
              answeredAt: record.answered_at ?? null,
              endedAt: record.ended_at ?? null,
            },
          });
          const finished = await this.ctx.store.getCall(callId);
          bus.publish({
            type: "call",
            incidentId: call.incidentId,
            callId,
            status: finished?.status ?? "completed",
          });
          return finished;
        }

        if (transcript && transcript !== call.transcript) {
          await this.ctx.store.updateCall(callId, { transcript, status: "answered" });
        }
      } catch (error) {
        this.ctx.log.warn("Call poll failed; will retry", { callId, error: describeError(error) });
      }
    }
  }

  /** Speech to text, so a coordinator can drive ARCA from a vehicle. */
  async transcribe(audio: Uint8Array, filename = "note.ogg"): Promise<string | null> {
    if (!env.slng.apiKey) return null;
    try {
      const form = new FormData();
      // Copy into a fresh ArrayBuffer: a Node Buffer view can be a slice of a
      // larger pooled allocation, and Blob would otherwise capture the whole pool.
      const bytes = new Uint8Array(audio.byteLength);
      bytes.set(audio);
      form.append("file", new Blob([bytes.buffer]), filename);
      const response = await fetch(`${env.slng.mediaUrl}/v1/stt/soniox/speech-ai:rt-v5`, {
        method: "POST",
        headers: { authorization: `Bearer ${env.slng.apiKey}` },
        body: form,
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
        text?: string;
      };
      return (
        payload.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? payload.text ?? null
      );
    } catch (error) {
      this.ctx.log.warn("Transcription failed", { error: describeError(error) });
      return null;
    }
  }
}

function toArguments(script: CallScript): Record<string, string> {
  return {
    site_name: script.siteName,
    site_type: script.siteType,
    fire_eta_minutes: script.fireEtaMinutes === null ? "unknown" : String(Math.round(script.fireEtaMinutes)),
    recommended_action: script.recommendedAction,
    registered_people: script.registeredPeople === null ? "unknown" : String(script.registeredPeople),
    coordinator_callback: script.coordinatorCallback,
    exercise_mode: script.exerciseMode ? "true" : "false",
  };
}

/** SLNG may return a transcript as a string or as a turn list. */
function normaliseTranscript(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((turn) => {
        if (typeof turn === "string") return turn;
        const record = turn as Record<string, unknown>;
        const role = String(record.role ?? record.speaker ?? "");
        const text = String(record.text ?? record.content ?? record.message ?? "");
        return text ? `${role ? `${role}: ` : ""}${text}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return null;
}

function describeAction(action: RankedSite["action"], language: CallScript["language"]): string {
  const copy: Record<string, Record<RankedSite["action"], string>> = {
    es: {
      EVACUATE_NOW: "evacuar ahora",
      SHELTER_CANDIDATE: "confinarse y esperar instrucciones, o pedir transporte para evacuar",
      PREPARE: "preparar la evacuación y estar listos",
      MONITOR: "mantenerse alerta",
      EXCLUSION_ZONE: "zona de exclusión: no permitir acceso",
      RESOURCE_AT_RISK: "preparar la evacuación y avisar al centro de coordinación",
    },
    ca: {
      EVACUATE_NOW: "evacuar ara",
      SHELTER_CANDIDATE: "confinar-se i esperar instruccions, o demanar transport per evacuar",
      PREPARE: "preparar l'evacuació i estar a punt",
      MONITOR: "mantenir-se alerta",
      EXCLUSION_ZONE: "zona d'exclusió: no permetre l'accés",
      RESOURCE_AT_RISK: "preparar l'evacuació i avisar el centre de coordinació",
    },
    en: {
      EVACUATE_NOW: "evacuate now",
      SHELTER_CANDIDATE: "shelter in place and await instructions, or request transport to evacuate",
      PREPARE: "prepare to evacuate and stand by",
      MONITOR: "stay alert",
      EXCLUSION_ZONE: "exclusion zone: allow no access",
      RESOURCE_AT_RISK: "prepare to evacuate and notify the coordination centre",
    },
  };
  return copy[language]?.[action] ?? copy.en![action];
}
