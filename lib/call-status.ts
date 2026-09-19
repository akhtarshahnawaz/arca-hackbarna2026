/** Unmistakable Voice status strings. The model must repeat these verbatim. */

export const TEST_MODE_NO_CALL_PLACED = "Test mode, no call placed.";

export const SAY_THIS_EXACTLY_TEST_MODE = `SAY_THIS_EXACTLY: ${TEST_MODE_NO_CALL_PLACED}`;

export const SAY_THIS_EXACTLY_AWAITING_APPROVE =
  "SAY_THIS_EXACTLY: Call waiting for Approve. Typing Call is not approval.";

export const SAY_THIS_EXACTLY_LIVE = "SAY_THIS_EXACTLY: Live call placed.";

export const SAY_THIS_EXACTLY_FAILED = "SAY_THIS_EXACTLY: Call failed. No live call placed.";

export const SAY_THIS_EXACTLY_DENIED = "SAY_THIS_EXACTLY: Call denied. No call placed.";

export type CoordinatorCallStatus = {
  coordinatorMustRepeatVerbatim: string;
  call_status: string;
  placed: boolean;
  stub: boolean;
  live: boolean;
};

export function formatCoordinatorCallStatus(input: {
  stub?: boolean;
  status: string;
}): CoordinatorCallStatus {
  if (input.stub === true || input.status === "stubbed") {
    return {
      coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_TEST_MODE,
      call_status: "TEST_MODE_NO_CALL_PLACED",
      placed: false,
      stub: true,
      live: false,
    };
  }
  if (input.status === "failed") {
    return {
      coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_FAILED,
      call_status: "CALL_FAILED_NO_LIVE_CALL",
      placed: false,
      stub: false,
      live: false,
    };
  }
  if (input.status === "denied") {
    return {
      coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_DENIED,
      call_status: "CALL_DENIED",
      placed: false,
      stub: false,
      live: false,
    };
  }
  if (input.status === "awaiting_approval") {
    return {
      coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_AWAITING_APPROVE,
      call_status: "AWAITING_APPROVE_BUTTON",
      placed: false,
      stub: false,
      live: false,
    };
  }
  if (input.status === "dialing" || input.status === "approved") {
    return {
      coordinatorMustRepeatVerbatim: SAY_THIS_EXACTLY_LIVE,
      call_status: "LIVE_CALL_PLACED",
      placed: true,
      stub: false,
      live: true,
    };
  }
  return {
    coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: Call status is ${input.status.replaceAll("_", " ")}.`,
    call_status: input.status.toUpperCase(),
    placed: false,
    stub: false,
    live: false,
  };
}

export function callStatusLabel(status: string): string {
  if (status === "stubbed") return TEST_MODE_NO_CALL_PLACED;
  return status.replaceAll("_", " ");
}

export function modelMustEchoCallStatus(status: CoordinatorCallStatus): string {
  return [
    "CRITICAL — REPEAT THE NEXT LINE TO THE COORDINATOR VERBATIM.",
    "Never say the call is in progress, ringing, or placed unless that line says so.",
    status.coordinatorMustRepeatVerbatim,
  ].join(" ");
}
