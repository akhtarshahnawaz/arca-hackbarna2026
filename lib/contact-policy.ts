import seed from "../config/contact-policy.json";

export type MissedOutcome =
  | "no_answer"
  | "busy"
  | "voicemail"
  | "answered_hung_up_fast"
  | "answered_talked"
  | "failed";

export type ContactPolicy = {
  dashboardLabel: string;
  approvalRequiredForAllContact: boolean;
  oneApproveCoversRetryPlan: boolean;
  retryPolicyCopy: string;
  maxAttempts: number;
  hangupFollowUp: "flag_only" | "sms" | "telegram_farmer";
  hangupFollowUpNote: string;
  unapprovedAlertEscalateAfterMinutes: number;
  recordSeconds: number;
  fastHangupSeconds: number;
  autoVetoWindow: {
    enabled: boolean;
    note: string;
    optedIn: boolean;
    minRunsInsidePolygon: number;
    ensembleMembers: number;
    requireNegativeSpareTime: boolean;
    maxRecipients: number;
    vetoMinutes: number;
  };
  missedCall: {
    no_answer: { tries: number; offsetsMinutes: number[]; urgentOffsetsMinutes: number[] };
    busy: { tries: number; offsetsMinutes: number[]; urgentOffsetsMinutes: number[] };
    voicemail: { leaveShortMessage: boolean; retriesAfterMessage: number };
    answered_hung_up_fast: {
      retry: boolean;
      flagCoordinator: boolean;
      status: string;
      lowerRank: boolean;
    };
    answered_talked: {
      saveAnswer: boolean;
      connectCoordinatorSeconds: number;
      coordinatorNoAnswerCopy: string;
    };
    allTriesFailed: { status: string; pingCoordinator: boolean };
    jitterSeconds: [number, number];
  };
};

export function loadContactPolicy(): ContactPolicy {
  return seed as ContactPolicy;
}

export function contactPolicyLabel(policy: ContactPolicy = loadContactPolicy()): string {
  return policy.dashboardLabel;
}

export function approvalRequired(policy: ContactPolicy = loadContactPolicy()): boolean {
  return policy.approvalRequiredForAllContact === true;
}

/** Single retry rule: one Approve covers the plan. There is no “Approve again”. */
export function retryPolicyCopy(policy: ContactPolicy = loadContactPolicy()): string {
  return policy.retryPolicyCopy;
}

export function autoVetoEnabled(policy: ContactPolicy = loadContactPolicy()): boolean {
  return policy.autoVetoWindow.enabled === true;
}

export function hangupFollowsUpFarmer(policy: ContactPolicy = loadContactPolicy()): boolean {
  return policy.hangupFollowUp !== "flag_only";
}

export function retryOffsetsMinutes(
  outcome: MissedOutcome,
  spareTime: number | null,
  policy: ContactPolicy = loadContactPolicy(),
): number[] {
  if (outcome === "answered_hung_up_fast" || outcome === "answered_talked") return [];
  if (outcome === "voicemail") {
    return policy.missedCall.voicemail.retriesAfterMessage > 0 ? [policy.missedCall.no_answer.offsetsMinutes[0] ?? 2] : [];
  }
  const row = outcome === "busy" ? policy.missedCall.busy : policy.missedCall.no_answer;
  const urgent = spareTime !== null && spareTime < 0;
  return urgent ? row.urgentOffsetsMinutes : row.offsetsMinutes;
}

export function jitterMs(policy: ContactPolicy = loadContactPolicy()): number {
  const [min, max] = policy.missedCall.jitterSeconds;
  const low = Math.min(min, max) * 1000;
  const high = Math.max(min, max) * 1000;
  return low + Math.floor(Math.random() * (high - low + 1));
}

/**
 * First attempt is the Approve dial (T+0). Later attempts use offsets after
 * each failure, capped at maxAttempts (3). Unlimited retry is forbidden.
 */
export function nextRetryAt(input: {
  attempt: number;
  outcome: MissedOutcome;
  spareTime: number | null;
  now?: number;
  policy?: ContactPolicy;
  jitter?: number;
}): Date | null {
  const policy = input.policy ?? loadContactPolicy();
  if (input.attempt >= policy.maxAttempts) return null;
  const offsets = retryOffsetsMinutes(input.outcome, input.spareTime, policy);
  const offsetIndex = input.attempt - 1;
  if (offsetIndex < 0 || offsetIndex >= offsets.length) return null;
  const waitMin = offsets[offsetIndex];
  const jitter = input.jitter ?? jitterMs(policy);
  return new Date((input.now ?? Date.now()) + waitMin * 60_000 + jitter);
}

export function canScheduleRetry(input: {
  attempt: number;
  outcome: MissedOutcome;
  approved: boolean;
  policy?: ContactPolicy;
}): boolean {
  const policy = input.policy ?? loadContactPolicy();
  if (!input.approved || !policy.oneApproveCoversRetryPlan) return false;
  if (input.outcome === "answered_hung_up_fast" || input.outcome === "answered_talked") {
    return false;
  }
  return input.attempt < policy.maxAttempts;
}

export function classifyVonageStatus(input: {
  status?: string | null;
  durationSeconds?: number | null;
  machine?: boolean | null;
  transcript?: string | null;
  policy?: ContactPolicy;
}): MissedOutcome {
  const policy = input.policy ?? loadContactPolicy();
  const status = (input.status ?? "").toLowerCase();
  if (input.machine || status === "machine" || status.includes("voicemail")) {
    return "voicemail";
  }
  if (status === "busy" || status === "rejected") return "busy";
  if (status === "unanswered" || status === "timeout" || status === "cancelled") {
    return "no_answer";
  }
  if (status === "failed") return "failed";
  if (status === "answered" || status === "complete" || status === "completed") {
    const duration = input.durationSeconds;
    const text = input.transcript?.trim() ?? "";
    if (
      (typeof duration === "number" && duration <= policy.fastHangupSeconds && text.length === 0) ||
      (typeof duration === "number" && duration <= policy.fastHangupSeconds)
    ) {
      if (text.length === 0) return "answered_hung_up_fast";
    }
    if (text.length > 0) return "answered_talked";
    if (typeof duration === "number" && duration <= policy.fastHangupSeconds) {
      return "answered_hung_up_fast";
    }
    return text.length > 0 ? "answered_talked" : "answered_hung_up_fast";
  }
  if (status === "started" || status === "ringing") return "no_answer";
  return "failed";
}

export function uiCallStatus(
  outcome: MissedOutcome | null,
  attempt: number,
  policy: ContactPolicy = loadContactPolicy(),
): "unanswered" | "busy" | "voicemail" | "hung up" | "confirmed" | "unreachable" | null {
  if (outcome === "no_answer" && attempt >= policy.maxAttempts) return "unreachable";
  if (outcome === "busy" && attempt >= policy.maxAttempts) return "unreachable";
  if (outcome === "failed" && attempt >= policy.maxAttempts) return "unreachable";
  if (outcome === "no_answer") return "unanswered";
  if (outcome === "busy") return "busy";
  if (outcome === "voicemail") return "voicemail";
  if (outcome === "answered_hung_up_fast") return "hung up";
  if (outcome === "answered_talked") return "confirmed";
  return null;
}
