import { randomUUID } from "node:crypto";
import {
  canScheduleRetry,
  classifyVonageStatus,
  loadContactPolicy,
  nextRetryAt,
  uiCallStatus,
  type MissedOutcome,
} from "./contact-policy";
import {
  getVoiceCall,
  insertVoiceCall,
  listDueVoiceRetries,
  listVoiceCalls,
  saveReportedConfirmation,
  saveSlngLog,
  updateVoiceCall,
  type VoiceCallRow,
} from "./db";
import { structurePhoneReport } from "./nebius-parse";
import { dtmfToReport, type PhoneReport } from "./phone-report";
import {
  arcaTransparencyLine,
  dtmfPromptScript,
  setSlngSink,
  siteCallScript,
  synthesizeSpeech,
  transcribeAudio,
} from "./slng";
import { coordinatorChatId, sendTelegramMessage, sendTelegramVoice } from "./telegram";
import type { VoiceCallStatus, VoiceCallSummary } from "./types";
import { last4 } from "./voice-status";
import { getVoiceStatus } from "./voice-status";
import { outcomeFromCapture } from "./voice-policy";
import { createOutboundCall, publicAudioUrl, transferCall } from "./vonage";

setSlngSink({
  persistLog: async (log) => {
    try {
      await saveSlngLog(log);
    } catch {
      // Schema already reported if the file could not open.
    }
  },
});

function statusFromOutcome(outcome: MissedOutcome, attempt: number): VoiceCallStatus {
  const ui = uiCallStatus(outcome, attempt);
  if (ui === "hung up") return "hung_up";
  if (ui === "confirmed") return "confirmed";
  if (ui === "unreachable") return "unreachable";
  if (ui === "unanswered") return "unanswered";
  if (ui === "busy") return "busy";
  if (ui === "voicemail") return "voicemail";
  return "dialing";
}

export function toVoiceSummary(row: VoiceCallRow): VoiceCallSummary {
  const outcome = (row.outcome as MissedOutcome | null) ?? null;
  return {
    id: row.id,
    siteId: row.siteId,
    toLast4: last4(row.toNumber),
    status: row.status as VoiceCallStatus,
    uiStatus: uiCallStatus(outcome, row.attempt),
    attempt: row.attempt,
    emptyHangup: row.emptyHangup,
    flagged: row.flagged,
    transcript: row.transcript,
    selfCorrected: row.selfCorrected,
    discardedCount: row.discardedCount,
    correctionCopy: row.correctionCopy,
    nextRetryAt: row.nextRetryAt,
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
  coordinatorNumber?: string | null;
  spareTime?: number | null;
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
    coordinatorNumber: input.coordinatorNumber ?? null,
    spareTime: input.spareTime ?? null,
  });
  return {
    call: toVoiceSummary(row),
    detail: `${loadContactPolicy().dashboardLabel} Approve once — that covers the retry plan (max ${loadContactPolicy().maxAttempts}).`,
  };
}

async function prepareCallAudio(town: string): Promise<{ audioId: string; dtmfAudioId: string }> {
  const intro = await synthesizeSpeech(siteCallScript(town));
  const dtmf = await synthesizeSpeech(dtmfPromptScript(town));
  return { audioId: intro.audioId, dtmfAudioId: dtmf.audioId };
}

async function dial(row: VoiceCallRow, town: string): Promise<VoiceCallRow> {
  const audio = row.audioId
    ? { audioId: row.audioId, dtmfAudioId: row.dtmfAudioId }
    : await prepareCallAudio(town);
  const placed = await createOutboundCall({
    toNumber: row.toNumber,
    callId: row.id,
  });
  const next = await updateVoiceCall(row.id, {
    status: placed.stub ? "stubbed" : placed.ok ? "dialing" : "failed",
    vonageUuid: placed.uuid,
    audioId: audio.audioId,
    dtmfAudioId: audio.dtmfAudioId,
    nextRetryAt: null,
  });
  return next ?? row;
}

export async function approveSiteCall(input: {
  callId: string;
  town?: string;
  coordinatorNumber?: string | null;
  retry?: boolean;
}): Promise<{ call: VoiceCallSummary; detail: string; stub: boolean }> {
  const existing = await getVoiceCall(input.callId);
  if (!existing) throw new Error("Unknown call request.");
  if (existing.status !== "awaiting_approval" && existing.status !== "approved") {
    throw new Error(`Call is ${existing.status}, not waiting for Approve.`);
  }

  const policy = loadContactPolicy();
  if (input.coordinatorNumber) {
    await updateVoiceCall(existing.id, { coordinatorNumber: input.coordinatorNumber });
  }
  const attempt = input.retry ? existing.attempt + 1 : Math.max(existing.attempt, 1);
  if (attempt > policy.maxAttempts) {
    throw new Error(`Call already used ${existing.attempt} of ${policy.maxAttempts} attempts.`);
  }
  await updateVoiceCall(existing.id, { status: "approved", attempt });
  const fresh = (await getVoiceCall(existing.id)) ?? existing;
  const dialed = await dial(fresh, input.town ?? "Font-rubí");
  return {
    call: toVoiceSummary(dialed),
    detail: policy.oneApproveCoversRetryPlan
      ? `Approved. This Approve covers the retry plan (max ${policy.maxAttempts}).`
      : "Approved.",
    stub: dialed.status === "stubbed",
  };
}

export async function denySiteCall(callId: string): Promise<VoiceCallSummary> {
  const next = await updateVoiceCall(callId, { status: "denied", nextRetryAt: null });
  if (!next) throw new Error("Unknown call request.");
  return toVoiceSummary(next);
}

async function pingCoordinator(text: string): Promise<void> {
  const chatId = coordinatorChatId();
  if (!chatId) return;
  await sendTelegramMessage(chatId, text);
}

async function savePhoneReport(siteId: string, report: PhoneReport): Promise<void> {
  if (report.count === null || !report.species) return;
  await saveReportedConfirmation({
    siteId,
    species: report.species,
    count: report.count,
    hasTransport: report.truck,
    channel: "phone",
    transcript: report.transcript,
    selfCorrected: report.self_corrected,
    discardedCount: report.discardedCount,
    correctionCopy: report.correctionCopy,
  });
}

async function applyOutcome(row: VoiceCallRow, outcome: MissedOutcome, extra?: Partial<VoiceCallRow>) {
  const policy = loadContactPolicy();
  const attempt = Math.max(row.attempt, 1);
  const status = statusFromOutcome(outcome, attempt);
  const flag =
    outcome === "answered_hung_up_fast" ||
    (status === "unreachable" && policy.missedCall.allTriesFailed.pingCoordinator);

  let retryIso: string | null = null;
  if (
    canScheduleRetry({
      attempt,
      outcome,
      approved: true,
    })
  ) {
    const when = nextRetryAt({
      attempt,
      outcome,
      spareTime: row.spareTime,
    });
    retryIso = when?.toISOString() ?? null;
  }

  const next = await updateVoiceCall(row.id, {
    status: status === "dialing" ? row.status : status,
    outcome,
    attempt,
    flagged: flag || row.flagged,
    emptyHangup: outcome === "answered_hung_up_fast",
    nextRetryAt: retryIso,
    ...extra,
  });

  if (outcome === "answered_hung_up_fast") {
    await pingCoordinator(
      `ARCA flag: ${row.siteId} answered then hung up. Status unconfirmed — not safe. Rank unchanged. Call by hand if needed.`,
    );
  }
  if (status === "unreachable") {
    await pingCoordinator(
      `ARCA: ${row.siteId} unreachable after ${policy.maxAttempts} tries. Call by hand or send someone.`,
    );
  }
  return next ?? row;
}

export async function handleVonageEvent(input: {
  callId: string;
  status?: string;
  durationSeconds?: number | null;
  machine?: boolean | null;
  uuid?: string | null;
}): Promise<VoiceCallSummary | null> {
  const call = await getVoiceCall(input.callId);
  if (!call) return null;
  if (input.uuid && !call.vonageUuid) {
    await updateVoiceCall(call.id, { vonageUuid: input.uuid });
  }
  const mid = (input.status ?? "").toLowerCase();
  if (mid === "started" || mid === "ringing" || mid === "answered") {
    return toVoiceSummary(call);
  }
  const outcome = classifyVonageStatus({
    status: input.status,
    durationSeconds: input.durationSeconds,
    machine: input.machine,
    transcript: call.transcript,
  });
  if (outcome === "answered_talked" && call.transcript) {
    return toVoiceSummary(call);
  }
  const next = await applyOutcome(call, outcome);
  return toVoiceSummary(next);
}

export async function handleRecordingWebhook(input: {
  callId: string;
  recordingUrl?: string;
  bytes?: Buffer;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  vonageStatus?: string | null;
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
  const outcome = outcomeFromCapture({
    vonageStatus: input.vonageStatus,
    durationSeconds: input.durationSeconds,
    sizeBytes: input.sizeBytes ?? bytes?.length ?? null,
    transcript: stt.transcript,
  });

  if (outcome === "answered_talked") {
    const report = await structurePhoneReport(stt.transcript);
    await savePhoneReport(call.siteId, report);
    const next = await updateVoiceCall(call.id, {
      status: "confirmed",
      outcome,
      transcript: stt.transcript,
      selfCorrected: report.self_corrected,
      discardedCount: report.discardedCount,
      correctionCopy: report.correctionCopy,
      emptyHangup: false,
      nextRetryAt: null,
    });
    await handoffToCoordinator(next ?? call);
    return toVoiceSummary(next ?? call);
  }

  const next = await applyOutcome(call, outcome, { transcript: stt.transcript || null });
  return toVoiceSummary(next);
}

async function handoffToCoordinator(call: VoiceCallRow): Promise<void> {
  const policy = loadContactPolicy();
  const seconds = policy.missedCall.answered_talked.connectCoordinatorSeconds;
  if (!call.vonageUuid || !call.coordinatorNumber) {
    await pingCoordinator(
      `ARCA: ${call.siteId} talked. Connect skipped (no coordinator number). Call them back.`,
    );
    return;
  }
  const callback = await synthesizeSpeech(policy.missedCall.answered_talked.coordinatorNoAnswerCopy);
  const transferred = await transferCall({
    uuid: call.vonageUuid,
    coordinatorNumber: call.coordinatorNumber,
    timeoutSeconds: seconds,
    fallbackStreamUrl: publicAudioUrl(callback.audioId),
  });
  if (!transferred.ok) {
    await pingCoordinator(
      `ARCA: ${call.siteId} talked. Coordinator connect failed. ${policy.missedCall.answered_talked.coordinatorNoAnswerCopy}`,
    );
  }
}

export async function handleDtmfWebhook(input: {
  callId: string;
  digits: string;
}): Promise<VoiceCallSummary> {
  const call = await getVoiceCall(input.callId);
  if (!call) throw new Error("Unknown call for DTMF.");
  if (call.status === "confirmed") return toVoiceSummary(call);

  const report = dtmfToReport(input.digits);
  if (report.count === null || !report.species) {
    const next = await applyOutcome(call, call.emptyHangup ? "answered_hung_up_fast" : "no_answer", {
      transcript: `${call.transcript ?? ""}\n${report.transcript}`.trim(),
    });
    return toVoiceSummary(next);
  }
  await savePhoneReport(call.siteId, report);
  const next = await updateVoiceCall(call.id, {
    status: "confirmed",
    outcome: "answered_talked",
    transcript: report.transcript,
    nextRetryAt: null,
  });
  await handoffToCoordinator(next ?? call);
  return toVoiceSummary(next ?? call);
}

export async function processDueVoiceRetries(town = "Font-rubí"): Promise<number> {
  const due = await listDueVoiceRetries().catch(() => []);
  let n = 0;
  for (const row of due) {
    const attempt = row.attempt + 1;
    const policy = loadContactPolicy();
    if (attempt > policy.maxAttempts) {
      await applyOutcome({ ...row, attempt }, row.outcome as MissedOutcome ?? "no_answer");
      continue;
    }
    await updateVoiceCall(row.id, { attempt, nextRetryAt: null, status: "dialing" });
    const fresh = (await getVoiceCall(row.id)) ?? row;
    await dial(fresh, town);
    n += 1;
  }
  return n;
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
  return audioId ? publicAudioUrl(audioId) : null;
}

export function contactPolicyPublic() {
  const policy = loadContactPolicy();
  return {
    dashboardLabel: policy.dashboardLabel,
    approvalRequiredForAllContact: policy.approvalRequiredForAllContact,
    oneApproveCoversRetryPlan: policy.oneApproveCoversRetryPlan,
    maxAttempts: policy.maxAttempts,
    hangupFollowUp: policy.hangupFollowUp,
    autoVetoEnabled: policy.autoVetoWindow.enabled,
  };
}
