import { describe, expect, it } from "vitest";
import {
  autoVetoEnabled,
  canScheduleRetry,
  classifyVonageStatus,
  hangupFollowsUpFarmer,
  loadContactPolicy,
  nextRetryAt,
  retryOffsetsMinutes,
  uiCallStatus,
} from "@/lib/contact-policy";

describe("contact policy file", () => {
  it("requires human approval and keeps the veto window off", () => {
    const policy = loadContactPolicy();
    expect(policy.approvalRequiredForAllContact).toBe(true);
    expect(policy.dashboardLabel).toBe("Contact policy: human approval required.");
    expect(autoVetoEnabled()).toBe(false);
    expect(policy.autoVetoWindow.enabled).toBe(false);
    expect(policy.maxAttempts).toBe(3);
    expect(policy.oneApproveCoversRetryPlan).toBe(true);
    expect(policy.hangupFollowUp).toBe("flag_only");
    expect(hangupFollowsUpFarmer()).toBe(false);
  });

  it("schedules no_answer retries at +2/+5/+10 and faster when already behind", () => {
    expect(retryOffsetsMinutes("no_answer", 2)).toEqual([2, 5, 10]);
    expect(retryOffsetsMinutes("busy", 2)).toEqual([2, 5, 10]);
    expect(retryOffsetsMinutes("no_answer", -1)).toEqual([1, 3, 5]);
    expect(retryOffsetsMinutes("answered_hung_up_fast", -1)).toEqual([]);
  });

  it("caps retries at 3 and forbids hang-up retry", () => {
    expect(
      canScheduleRetry({ attempt: 1, outcome: "no_answer", approved: true }),
    ).toBe(true);
    expect(
      canScheduleRetry({ attempt: 3, outcome: "no_answer", approved: true }),
    ).toBe(false);
    expect(
      canScheduleRetry({ attempt: 1, outcome: "answered_hung_up_fast", approved: true }),
    ).toBe(false);

    const second = nextRetryAt({
      attempt: 1,
      outcome: "no_answer",
      spareTime: 4,
      now: 0,
      jitter: 0,
    });
    expect(second?.getTime()).toBe(2 * 60_000);

    const afterCap = nextRetryAt({
      attempt: 3,
      outcome: "no_answer",
      spareTime: 4,
      now: 0,
      jitter: 0,
    });
    expect(afterCap).toBeNull();
  });

  it("maps Vonage statuses to the UI table", () => {
    expect(classifyVonageStatus({ status: "unanswered" })).toBe("no_answer");
    expect(classifyVonageStatus({ status: "busy" })).toBe("busy");
    expect(classifyVonageStatus({ status: "machine" })).toBe("voicemail");
    expect(classifyVonageStatus({ status: "completed", durationSeconds: 2, transcript: "" })).toBe(
      "answered_hung_up_fast",
    );
    expect(
      classifyVonageStatus({
        status: "completed",
        durationSeconds: 16,
        transcript: "trescientas ovejas",
      }),
    ).toBe("answered_talked");
    expect(uiCallStatus("answered_hung_up_fast", 1)).toBe("hung up");
    expect(uiCallStatus("no_answer", 3)).toBe("unreachable");
    expect(uiCallStatus("answered_talked", 1)).toBe("confirmed");
  });
});
