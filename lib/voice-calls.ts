import { randomUUID } from "node:crypto";
import {
  getVoiceCall,
  insertVoiceCall,
  listVoiceCalls,
  saveReportedConfirmation,
  saveSlngLog,
  updateVoiceCall,
  type VoiceCallRow,
} from "@/lib/db";
import { structurePhoneReport } from "@/lib/nebius-parse";
import { dtmfToReport, type PhoneReport } from "@/lib/phone-report";
import {
  arcaTransparencyLine,
  dtmfPromptScript,
  setSlngSink,
  siteCallScript,
  synthesizeSpeech,
  transcribeAudio,
} from "@/lib/slng";
import { last4 } from "@/lib/voice-status";
import {
  canReapproveVoiceRetry,
  isEmptyVoiceCapture,
  voiceEmptyHangupCopy,
  VOICE_CALL_POLICY,
} from "@/lib/voice-policy";
import { createOutboundCall, publicAudioUrl } from "@/lib/vonage";
import { coordinatorChatId, sendTelegramMessage, sendTelegramVoice } from "@/lib/telegram";
import type { VoiceCallSummary } from "@/lib/types";
import { getVoiceStatus } from "@/lib/voice-status";

setSlngSink({
  persistLog: async (log) => {
    try {
      await saveSlngLog(log);
    } catch {
      // Schema already reported if the file could not open.
    }
  },
});

export function toVoiceSummary(row: VoiceCallRow): VoiceCallSummary {
  return {
    id: row.id,
    siteId: row.siteId,
    toLast4: last4(row.toNumber),
    status: row.status as VoiceCallSummary["status"],
    attempt: row.attempt,
    emptyHangup: row.emptyHangup,
    flagged: row.flagged,
    telegramFollowup: row.telegramFollowup,
    transcript: row.transcript,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listVoiceSummaries(): Promise<VoiceCallSummary[]> {
  try {
    return (await listVoiceCalls()).map(toVoiceSummary);
  } catch {
    return [];
  }
}

export async function requestSiteCall(input: {
  siteId: string;
  toNumber: string;
}): Promise<{ call: VoiceCallSummary; detail: string }> {
  const toNumber = input.toNumber.trim();
  if (!toNumber) {
    throw new Error("Coordinator must enter a number. Seed data has no phones.");
  }
  const row = await insertVoiceCall({
    id: randomUUID(),
    siteId: input.siteId.trim(),
    toNumber,
    status: "awaiting_approval",
    attempt: 0,
  });
  return {
    call: toVoiceSummary(row),
    detail: "Waiting for Approve. ARCA will not dial until a human says yes.",
  };
}

async function prepareCallAudio(town: string): Promise<{ audioId: string; dtmfAudioId: string }> {
  const intro = await synthesizeSpeech(siteCallScript(town));
  const dtmf = await synthesizeSpeech(dtmfPromptScript(town));
  return { audioId: intro.audioId, dtmfAudioId: dtmf.audioId };
}

export async function approveSiteCall(input: {
  callId: string;
  town?: string;
  retry?: boolean;
}): Promise<{ call: VoiceCallSummary; detail: string; stub: boolean }> {
  const existing = await getVoiceCall(input.callId);
  if (!existing) throw new Error("Unknown call request.");

  if (input.retry) {
    if (
      !canReapproveVoiceRetry({
        attempt: existing.attempt,
        emptyHangup: existing.emptyHangup,
        coordinatorReapproved: true,
      })
    ) {
      throw new Error("No more retries. Empty hangup already used its one re-Approve.");
    }
  } else if (existing.status !== "awaiting_approval") {
    throw new Error(`Call is ${existing.status}, not waiting for Approve.`);
  }

  const town = input.town ?? "Font-rubí";
  const audio = await prepareCallAudio(town);
  const attempt = input.retry ? existing.attempt + 1 : existing.attempt;
  await updateVoiceCall(existing.id, {
    status: "approved",
    attempt,
    audioId: audio.audioId,
    dtmfAudioId: audio.dtmfAudioId,
  });

  const placed = await createOutboundCall({
    toNumber: existing.toNumber,
    callId: existing.id,
  });

  const next = await updateVoiceCall(existing.id, {
    status: placed.stub ? "stubbed" : placed.ok ? "dialing" : "failed",
    vonageUuid: placed.uuid,
  });

  return {
    call: toVoiceSummary(next ?? existing),
    detail: placed.detail,
    stub: placed.stub,
  };
}

export async function denySiteCall(callId: string): Promise<VoiceCallSummary> {
  const next = await updateVoiceCall(callId, { status: "denied" });
  if (!next) throw new Error("Unknown call request.");
  return toVoiceSummary(next);
}

async function savePhoneReport(siteId: string, report: PhoneReport): Promise<void> {
  if (report.count === null || !report.species) return;
  await saveReportedConfirmation({
    siteId,
    species: report.species,
    count: report.count,
    hasTransport: report.truck,
    channel: "phone",
  });
}

export async function handleRecordingWebhook(input: {
  callId: string;
  recordingUrl?: string;
  bytes?: Buffer;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
}): Promise<VoiceCallSummary> {
  const call = await getVoiceCall(input.callId);
  if (!call) throw new Error("Unknown call for recording webhook.");

  let bytes = input.bytes ?? null;
  if (!bytes && input.recordingUrl) {
    const { downloadVonageRecording } = await import("@/lib/vonage");
    bytes = await downloadVonageRecording(input.recordingUrl);
  }

  const stt = await transcribeAudio({
    bytes: bytes ?? undefined,
    url: !bytes ? input.recordingUrl : undefined,
    mimeType: "audio/mpeg",
  });
  const empty = isEmptyVoiceCapture({
    durationSeconds: input.durationSeconds,
    sizeBytes: input.sizeBytes ?? bytes?.length ?? null,
    transcript: stt.transcript,
  });

  if (empty) {
    const next = await updateVoiceCall(call.id, {
      status: "empty",
      transcript: stt.transcript || null,
      emptyHangup: true,
      flagged: true,
    });
    if (VOICE_CALL_POLICY.telegramFollowUpOnEmpty && !call.telegramFollowup) {
      const chatId = coordinatorChatId();
      if (chatId) {
        await sendTelegramMessage(
          chatId,
          [
            `ARCA: empty Voice answer for ${call.siteId} (last4 ${last4(call.toNumber)}).`,
            voiceEmptyHangupCopy(),
          ].join(" "),
        );
        await updateVoiceCall(call.id, { telegramFollowup: true });
      }
    }
    return toVoiceSummary(next ?? call);
  }

  const report = await structurePhoneReport(stt.transcript);
  await savePhoneReport(call.siteId, report);
  const next = await updateVoiceCall(call.id, {
    status: "reported",
    transcript: stt.transcript,
    emptyHangup: false,
  });
  return toVoiceSummary(next ?? call);
}

export async function handleDtmfWebhook(input: {
  callId: string;
  digits: string;
}): Promise<VoiceCallSummary> {
  const call = await getVoiceCall(input.callId);
  if (!call) throw new Error("Unknown call for DTMF.");
  if (call.status === "reported") return toVoiceSummary(call);

  const report = dtmfToReport(input.digits);
  if (report.count === null || !report.species) {
    const next = await updateVoiceCall(call.id, {
      status: call.emptyHangup ? "empty" : call.status,
      flagged: true,
      transcript: `${call.transcript ?? ""}\n${report.transcript}`.trim(),
    });
    return toVoiceSummary(next ?? call);
  }
  await savePhoneReport(call.siteId, report);
  const next = await updateVoiceCall(call.id, {
    status: "reported",
    transcript: report.transcript,
  });
  return toVoiceSummary(next ?? call);
}

export async function sendApprovedTelegramVoice(input: {
  chatId: string;
  town: string;
  extra?: string;
}): Promise<{ ok: boolean; detail: string }> {
  const text = [arcaTransparencyLine(input.town), input.extra ?? ""].filter(Boolean).join(" ");
  const tts = await synthesizeSpeech(text);
  return sendTelegramVoice(input.chatId, tts.bytes, text.slice(0, 180));
}

export function voiceBanner(): string | null {
  return getVoiceStatus().banner;
}

export function publicStreamUrl(audioId: string | null): string | null {
  if (!audioId) return null;
  return publicAudioUrl(audioId);
}
