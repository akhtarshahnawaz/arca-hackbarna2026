/**
 * Outbound Voice policy. A human Approves every call. ARCA never loops.
 *
 * Empty ~3 s hangup: Vonage still posts the recording webhook. Flag the
 * coordinator. Optional one Telegram follow-up. Do not auto-retry.
 * Max one retry, and only if the coordinator Approves again. Then stop.
 */
export const VOICE_CALL_POLICY = {
  requireCoordinatorApproval: true,
  recordSeconds: 18,
  emptyHangupSilenceSeconds: 3,
  autoRetryOnEmpty: false,
  telegramFollowUpOnEmpty: true,
  maxAttempts: 2,
  maxRetryAfterReapprove: 1,
  dtmfFallback: true,
} as const;

export type VoiceRetryInput = {
  attempt: number;
  emptyHangup: boolean;
  coordinatorReapproved: boolean;
};

export function shouldAutoRetryVoiceCall(): boolean {
  return VOICE_CALL_POLICY.autoRetryOnEmpty;
}

export function canReapproveVoiceRetry(input: VoiceRetryInput): boolean {
  if (!input.emptyHangup) return false;
  if (!input.coordinatorReapproved) return false;
  return input.attempt < VOICE_CALL_POLICY.maxRetryAfterReapprove;
}

export function voiceEmptyHangupCopy(): string {
  return [
    "Empty or near-silent answer. Vonage still delivered the webhook.",
    "Not retrying in a loop.",
    "Optional one Telegram follow-up to the coordinator.",
    "Approve once more for a single retry, then ARCA stops.",
  ].join(" ");
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
  const text = input.transcript?.trim() ?? "";
  return text.length === 0;
}
