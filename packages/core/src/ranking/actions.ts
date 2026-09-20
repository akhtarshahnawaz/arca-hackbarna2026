import { rankingPolicy } from "../config/index.js";
import type { ProtectiveAction, ReachStats } from "../domain/types.js";

export interface ActionInput {
  reach: ReachStats;
  spareMinutes: number | null;
  arrivalMinutes: number | null;
  hazardous: boolean;
  responseAsset: boolean;
  humanBearing: boolean;
}

export interface ActionDecision {
  action: ProtectiveAction;
  reason: string;
}

/**
 * The recommended protective action, as a rule table rather than a model call.
 *
 * Order matters and is deliberate. Hazardous sites are resolved first because
 * the instruction there is aimed at responders, not occupants — telling a fuel
 * depot to evacuate its (zero) residents would bury the fact that nobody should
 * be driving an engine past it. Shelter-in-place outranks evacuate because when
 * the clock has already run out, sending people onto a road the fire is about
 * to cross is worse than keeping them in a building.
 */
export function decideAction(input: ActionInput): ActionDecision {
  const policy = rankingPolicy;

  if (input.reach.pReach < policy.watchBelowProbability) {
    return {
      action: "MONITOR",
      reason: `Only ${input.reach.runsReaching} of ${input.reach.runsTotal} runs reach this site inside the horizon, below the ${Math.round(
        policy.watchBelowProbability * 100,
      )}% watch threshold.`,
    };
  }

  if (
    input.hazardous &&
    input.arrivalMinutes !== null &&
    input.arrivalMinutes <= policy.actions.exclusionZoneWithinMinutes
  ) {
    return {
      action: "EXCLUSION_ZONE",
      reason: `Hazardous site with fire arriving in about ${input.arrivalMinutes} min. Keep responders and traffic out; this is not an evacuation instruction.`,
    };
  }

  if (input.spareMinutes === null) {
    return {
      action: "PREPARE",
      reason: "Fire reaches this site inside the horizon but no arrival time could be pinned down. Treat as prepare and confirm by phone.",
    };
  }

  if (input.spareMinutes < 0) {
    return {
      action: "SHELTER_CANDIDATE",
      reason: `Evacuation needs about ${Math.abs(
        input.spareMinutes,
      )} min longer than the fire is expected to take. Moving people now may put them on the road as the front arrives — shelter in place, or request transport and escort. Coordinator decides with Bombers.`,
    };
  }

  if (input.spareMinutes < policy.actions.prepareAboveSpareMinutes) {
    return {
      action: "EVACUATE_NOW",
      reason: `About ${input.spareMinutes} min of spare time. Movement has to start now to finish before the front arrives.`,
    };
  }

  if (input.responseAsset) {
    return {
      action: "RESOURCE_AT_RISK",
      reason: `${input.spareMinutes} min of spare time, but losing this site removes response capacity mid-incident. Flag to command.`,
    };
  }

  return {
    action: "PREPARE",
    reason: `About ${Math.round(
      input.spareMinutes / 60,
    )} h of spare time. Warn the site and ready vehicles; re-check after the next model run.`,
  };
}

export const ACTION_LABELS: Record<ProtectiveAction, string> = {
  EVACUATE_NOW: "Evacuate now",
  SHELTER_CANDIDATE: "Shelter-in-place candidate",
  PREPARE: "Prepare",
  MONITOR: "Monitor",
  EXCLUSION_ZONE: "Exclusion zone",
  RESOURCE_AT_RISK: "Resource at risk",
};

/** Ordering for the map legend and the list's colour bands. */
export const ACTION_SEVERITY: Record<ProtectiveAction, number> = {
  SHELTER_CANDIDATE: 5,
  EVACUATE_NOW: 4,
  EXCLUSION_ZONE: 3,
  RESOURCE_AT_RISK: 2,
  PREPARE: 1,
  MONITOR: 0,
};
