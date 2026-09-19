import {
  classifyVonageStatus,
  loadContactPolicy,
  type MissedOutcome,
} from "./contact-policy";

const policy = loadContactPolicy();

/** Voice timings and caps — values come from config/contact-policy.json. */
export const VOICE_CALL_POLICY = {
  requireCoordinatorApproval: policy.approvalRequiredForAllContact,
  oneApproveCoversRetryPlan: policy.oneApproveCoversRetryPlan,
  recordSeconds: policy.recordSeconds,
  emptyHangupSilenceSeconds: policy.fastHangupSeconds,
  autoRetryOnEmpty: false,
  hangupFollowUp: policy.hangupFollowUp,
  maxAttempts: policy.maxAttempts,
  dtmfFallback: true,
} as const;

export function shouldAutoRetryVoiceCall(): boolean {
  return false;
}

export function isEmptyVoiceCapture(input: {
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  transcript?: string | null;
}): boolean {
  const duration = input.durationSeconds;
  if (typeof duration === "number" && duration <= VOICE_CALL_POLICY.emptyHangupSilenceSeconds) {
    return true;
  }
  if (typeof input.sizeBytes === "number" && input.sizeBytes > 0 && input.sizeBytes < 2500) {
    return true;
  }
  return (input.transcript?.trim() ?? "").length === 0;
}

export function outcomeFromCapture(input: {
  vonageStatus?: string | null;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  transcript?: string | null;
  machine?: boolean | null;
}): MissedOutcome {
  if (input.machine) return "voicemail";
  if (input.vonageStatus) {
    return classifyVonageStatus({
      status: input.vonageStatus,
      durationSeconds: input.durationSeconds,
      machine: input.machine,
      transcript: input.transcript,
    });
  }
  if (isEmptyVoiceCapture(input)) return "answered_hung_up_fast";
  return "answered_talked";
}

export function voiceHungUpCopy(): string {
  return [
    "Answered then hung up fast. Status unconfirmed — not safe.",
    "Not retrying. Rank is unchanged.",
    "Coordinator flagged. No Telegram to the farmer.",
  ].join(" ");
}
