import { describe, expect, it } from "vitest";
import {
  callStatusLabel,
  formatCoordinatorCallStatus,
  modelMustEchoCallStatus,
  SAY_THIS_EXACTLY_TEST_MODE,
  TEST_MODE_NO_CALL_PLACED,
} from "@/lib/call-status";

describe("coordinator call status", () => {
  it("forces a verbatim test-mode line when the dial is stubbed", () => {
    const status = formatCoordinatorCallStatus({ stub: true, status: "stubbed" });
    expect(status.coordinatorMustRepeatVerbatim).toBe(SAY_THIS_EXACTLY_TEST_MODE);
    expect(status.coordinatorMustRepeatVerbatim).toContain(TEST_MODE_NO_CALL_PLACED);
    expect(status.call_status).toBe("TEST_MODE_NO_CALL_PLACED");
    expect(status.placed).toBe(false);
    expect(status.live).toBe(false);
    expect(modelMustEchoCallStatus(status)).toMatch(/REPEAT THE NEXT LINE/i);
    expect(modelMustEchoCallStatus(status)).toContain(TEST_MODE_NO_CALL_PLACED);
  });

  it("does not claim a live call while awaiting the Approve button", () => {
    const status = formatCoordinatorCallStatus({ status: "awaiting_approval" });
    expect(status.placed).toBe(false);
    expect(status.coordinatorMustRepeatVerbatim).toMatch(/Typing Call is not approval/);
  });

  it("labels stubbed rows as test mode for the map", () => {
    expect(callStatusLabel("stubbed")).toBe(TEST_MODE_NO_CALL_PLACED);
  });
});
