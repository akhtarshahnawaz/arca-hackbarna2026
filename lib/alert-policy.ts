/**
 * Mass-alert policy. Anything that reaches many people at once is risky.
 *
 * If the coordinator does not Approve for 30 minutes while the fire moves,
 * ARCA must NOT mass-alert residents. Escalate: nudge the coordinator, then
 * the backup contact. Never auto-approve a blast because the clock ran out.
 *
 * Narrow auto-exception — comment/config only, NEVER default-on:
 * a single opted-in resident already inside the polygon in ≥9/10 runs with
 * negative spare_time. That is one person who already opted in, not 200.
 * Do not encode a silent send. Leave `allowSingleResidentAutoAlert` false.
 */
export const MASS_ALERT_POLICY = {
  requireCoordinatorApproval: true,
  escalateAfterMinutes: 30,
  allowSingleResidentAutoAlert: false,
  singleResidentAutoAlert: {
    optedIn: true,
    minRunsInsidePolygon: 9,
    ensembleMembers: 10,
    requireNegativeSpareTime: true,
    maxRecipients: 1,
  },
} as const;

export function shouldEscalateUnapprovedAlert(pendingMinutes: number): boolean {
  return pendingMinutes >= MASS_ALERT_POLICY.escalateAfterMinutes;
}

export function massAlertBlockedReason(): string {
  return [
    "Resident mass-alert is blocked until a coordinator Approves.",
    `If Approve does not arrive in ${MASS_ALERT_POLICY.escalateAfterMinutes} minutes, escalate — do not blast.`,
    "ARCA never auto-sends to a list because the fire moved.",
  ].join(" ");
}
