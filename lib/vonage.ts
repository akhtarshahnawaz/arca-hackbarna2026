import { createSign, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getVoiceStatus, voiceWebhookBase } from "./voice-status";
import { VOICE_CALL_POLICY } from "./voice-policy";

export type NccoAction = Record<string, unknown>;

export function joinWebhook(path: string): string {
  const base = voiceWebhookBase().replace(/\/$/, "");
  return `${base}${path}`;
}

export async function readVonagePrivateKey(): Promise<string | null> {
  const keyPath = process.env.VONAGE_PRIVATE_KEY_PATH?.trim();
  if (!keyPath) return null;
  try {
    return await readFile(keyPath, "utf8");
  } catch {
    return null;
  }
}

export function signVonageJwt(applicationId: string, privateKeyPem: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      application_id: applicationId,
      iat: now,
      exp: now + 15 * 60,
      jti: randomUUID(),
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  const signature = signer.sign(privateKeyPem).toString("base64url");
  return `${data}.${signature}`;
}

export async function vonageBearer(): Promise<string | null> {
  const applicationId = process.env.VONAGE_APPLICATION_ID?.trim();
  const pem = await readVonagePrivateKey();
  if (!applicationId || !pem) return null;
  return signVonageJwt(applicationId, pem);
}

export function buildAnswerNcco(input: {
  callId: string;
  streamUrl: string;
  dtmfPromptUrl?: string;
}): NccoAction[] {
  const recordUrl = joinWebhook(`/api/voice/recording?callId=${encodeURIComponent(input.callId)}`);
  const dtmfUrl = joinWebhook(`/api/voice/dtmf?callId=${encodeURIComponent(input.callId)}`);
  const actions: NccoAction[] = [
    {
      action: "stream",
      streamUrl: [input.streamUrl],
    },
    {
      action: "record",
      format: "mp3",
      timeOut: VOICE_CALL_POLICY.recordSeconds,
      endOnSilence: VOICE_CALL_POLICY.emptyHangupSilenceSeconds,
      beepStart: true,
      eventUrl: [recordUrl],
      eventMethod: "POST",
    },
  ];
  if (input.dtmfPromptUrl) {
    actions.push({
      action: "stream",
      streamUrl: [input.dtmfPromptUrl],
    });
  }
  actions.push({
    action: "input",
    type: ["dtmf"],
    eventUrl: [dtmfUrl],
    eventMethod: "POST",
    dtmf: {
      maxDigits: 8,
      timeOut: 10,
      submitOnHash: true,
    },
  });
  return actions;
}

export async function createOutboundCall(input: {
  toNumber: string;
  callId: string;
}): Promise<{ ok: boolean; uuid: string | null; stub: boolean; detail: string }> {
  const status = getVoiceStatus();
  const from = process.env.VONAGE_FROM_NUMBER?.trim();
  if (!status.canPlaceLiveCall || !from) {
    return {
      ok: true,
      uuid: null,
      stub: true,
      detail: status.banner ?? "Vonage Voice stub — keys or public webhook missing.",
    };
  }

  const token = await vonageBearer();
  if (!token) {
    return {
      ok: false,
      uuid: null,
      stub: true,
      detail: "Vonage JWT missing — check VONAGE_APPLICATION_ID and VONAGE_PRIVATE_KEY_PATH.",
    };
  }

  const answerUrl = joinWebhook(`/api/voice/answer?callId=${encodeURIComponent(input.callId)}`);
  const eventUrl = joinWebhook(`/api/voice/events?callId=${encodeURIComponent(input.callId)}`);

  try {
    const response = await fetch("https://api.nexmo.com/v1/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [{ type: "phone", number: input.toNumber.replace(/\D/g, "") }],
        from: { type: "phone", number: from.replace(/\D/g, "") },
        answer_url: [answerUrl],
        answer_method: "GET",
        event_url: [eventUrl],
        event_method: "POST",
      }),
    });
    const json = (await response.json().catch(() => null)) as { uuid?: string; title?: string } | null;
    if (!response.ok || !json?.uuid) {
      return {
        ok: false,
        uuid: null,
        stub: false,
        detail: json?.title || `Vonage create call failed (${response.status})`,
      };
    }
    return { ok: true, uuid: json.uuid, stub: false, detail: "dialing" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "vonage failed";
    return { ok: false, uuid: null, stub: false, detail: message };
  }
}

export async function downloadVonageRecording(recordingUrl: string): Promise<Buffer | null> {
  const token = await vonageBearer();
  if (!token) return null;
  const response = await fetch(recordingUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

export function publicAudioUrl(audioId: string): string {
  const base = voiceWebhookBase().replace(/\/$/, "");
  if (!base) return `/api/voice/audio/${audioId}`;
  return `${base}/api/voice/audio/${audioId}`;
}

export function buildHandoffNcco(input: {
  coordinatorNumber: string;
  timeoutSeconds: number;
  fallbackStreamUrl: string;
}): NccoAction[] {
  const from = process.env.VONAGE_FROM_NUMBER?.trim() ?? "";
  return [
    {
      action: "connect",
      timeout: input.timeoutSeconds,
      from,
      endpoint: [{ type: "phone", number: input.coordinatorNumber.replace(/\D/g, "") }],
    },
    {
      action: "stream",
      streamUrl: [input.fallbackStreamUrl],
    },
  ];
}

export async function transferCall(input: {
  uuid: string;
  coordinatorNumber: string;
  timeoutSeconds: number;
  fallbackStreamUrl: string;
}): Promise<{ ok: boolean; stub: boolean; detail: string }> {
  const status = getVoiceStatus();
  if (!status.canPlaceLiveCall) {
    return { ok: true, stub: true, detail: "Connect stubbed — Vonage not live." };
  }
  const token = await vonageBearer();
  if (!token) return { ok: false, stub: true, detail: "Vonage JWT missing." };
  try {
    const response = await fetch(`https://api.nexmo.com/v1/calls/${input.uuid}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "transfer",
        destination: {
          type: "ncco",
          ncco: buildHandoffNcco(input),
        },
      }),
    });
    if (!response.ok) {
      return { ok: false, stub: false, detail: `Vonage transfer failed (${response.status})` };
    }
    return { ok: true, stub: false, detail: "connect" };
  } catch (error) {
    return {
      ok: false,
      stub: false,
      detail: error instanceof Error ? error.message : "transfer failed",
    };
  }
}
