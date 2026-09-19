export const PROTECTIVE_ACTIONS = ["monitor", "latent", "confine", "evacuate"] as const;

export type ProtectiveAction = (typeof PROTECTIVE_ACTIONS)[number];

export function isProtectiveAction(value: unknown): value is ProtectiveAction {
  return (
    typeof value === "string" &&
    (PROTECTIVE_ACTIONS as readonly string[]).includes(value)
  );
}

/** ARCA may place a call only after the coordinator picks one of these. */
export function arcaMayCall(action: ProtectiveAction | null): boolean {
  return action === "confine" || action === "evacuate";
}

export const actionLabel: Record<ProtectiveAction, string> = {
  monitor: "Monitor",
  latent: "Latent",
  confine: "Confine",
  evacuate: "Evacuate",
};

export function actionEffectCopy(action: ProtectiveAction | null): string {
  if (action === "monitor") {
    return "You chose monitor. ARCA will not contact them. Keep an eye on the clocks.";
  }
  if (action === "latent") {
    return "You chose latent. Held. No call and no alert until you change this.";
  }
  if (action === "confine") {
    return "You chose confine. ARCA may call only to say stay inside, close the doors, and do not drive. You still Approve that call.";
  }
  if (action === "evacuate") {
    return "You chose evacuate. ARCA may call to say leave toward the shelter you configured. You still Approve that call. Only if Bombers say go.";
  }
  return "No action chosen. Follow the official instruction for this zone. ARCA will not call.";
}
