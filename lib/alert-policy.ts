import { loadContactPolicy } from "@/lib/contact-policy";

const policy = loadContactPolicy();

/**
 * Mass-alert policy. Values come from config/contact-policy.json.
 * Demo: a human Approves every contact. The opted-in 9/10 + veto window
 * stays in that file with enabled: false.
 */
export const MASS_ALERT_POLICY = {
  requireCoordinatorApproval: policy.approvalRequiredForAllContact,
  escalateAfterMinutes: policy.unapprovedAlertEscalateAfterMinutes,
  allowSingleResidentAutoAlert: policy.autoVetoWindow.enabled,
  singleResidentAutoAlert: {
    optedIn: policy.autoVetoWindow.optedIn,
    minRunsInsidePolygon: policy.autoVetoWindow.minRunsInsidePolygon,
    ensembleMembers: policy.autoVetoWindow.ensembleMembers,
    requireNegativeSpareTime: policy.autoVetoWindow.requireNegativeSpareTime,
    maxRecipients: policy.autoVetoWindow.maxRecipients,
    vetoMinutes: policy.autoVetoWindow.vetoMinutes,
  },
} as const;

export function shouldEscalateUnapprovedAlert(pendingMinutes: number): boolean {
  return pendingMinutes >= MASS_ALERT_POLICY.escalateAfterMinutes;
}

export function massAlertBlockedReason(): string {
  return [
    loadContactPolicy().dashboardLabel,
    `If Approve does not arrive in ${MASS_ALERT_POLICY.escalateAfterMinutes} minutes, escalate — do not blast.`,
    "The auto-veto window is off for this demo.",
  ].join(" ");
}
