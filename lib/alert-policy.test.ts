import { describe, expect, it } from "vitest";
import {
  MASS_ALERT_POLICY,
  massAlertBlockedReason,
  shouldEscalateUnapprovedAlert,
} from "@/lib/alert-policy";

describe("mass alert policy", () => {
  it("never enables the single-resident auto-send exception", () => {
    expect(MASS_ALERT_POLICY.requireCoordinatorApproval).toBe(true);
    expect(MASS_ALERT_POLICY.allowSingleResidentAutoAlert).toBe(false);
    expect(MASS_ALERT_POLICY.escalateAfterMinutes).toBe(30);
  });

  it("escalates after 30 minutes instead of blasting", () => {
    expect(shouldEscalateUnapprovedAlert(29)).toBe(false);
    expect(shouldEscalateUnapprovedAlert(30)).toBe(true);
    expect(massAlertBlockedReason()).toMatch(/do not blast/i);
    expect(massAlertBlockedReason()).toMatch(/Approve/i);
  });
});
