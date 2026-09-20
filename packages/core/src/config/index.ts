import cleaningPolicyJson from "./cleaning-policy.json" with { type: "json" };
import rankingPolicyJson from "./ranking-policy.json" with { type: "json" };
import evacTimesJson from "./evac-times.json" with { type: "json" };
import type { SensorClass } from "../domain/types.js";

export interface CleaningPolicy {
  staticSourceBufferMeters: Record<SensorClass, number>;
  staticSourceBufferNote: string;
  duplicateWindowMinutes: number;
  duplicateRadiusFractionOfPixel: number;
  duplicateRadiusMinMeters: number;
  duplicateNote: string;
  staleHours: number;
  lowConfidenceNeedsCorroboration: boolean;
  confirmation: {
    credibleDetectionPoints: number;
    credibleDetectionNote: string;
    multiSourcePoints: number;
    multiSourceMinimum: number;
    temporalPersistencePoints: number;
    temporalPersistenceMinutes: number;
    highConfidencePoints: number;
    frpModeratePoints: number;
    frpModerateMw: number;
    frpStrongPoints: number;
    frpStrongMw: number;
    perimeterPoints: number;
    geostationaryOnlyPenalty: number;
    allMaskedPenalty: number;
    confirmedAt: number;
    candidateAt: number;
  };
}

export interface RankingPolicy {
  horizonHours: number;
  ensembleMembers: number;
  probabilityFloor: number;
  probabilityFloorNote: string;
  majorityProbability: number;
  watchBelowProbability: number;
  likelyAtProbability: number;
  actions: {
    prepareAboveSpareMinutes: number;
    exclusionZoneWithinMinutes: number;
  };
}

export interface EvacEntry {
  base: number;
  perPerson: number;
  note?: string;
}

export interface EvacTimes {
  default: EvacEntry;
  bySubcategory: Record<string, EvacEntry>;
  livestock: {
    per100Default: number;
    per100BySpecies: Record<string, number>;
    maxMinutes: number;
    maxMinutesNote: string;
  };
  maxMinutes: number;
}

export const cleaningPolicy = cleaningPolicyJson as unknown as CleaningPolicy;
export const rankingPolicy = rankingPolicyJson as unknown as RankingPolicy;
export const evacTimes = evacTimesJson as unknown as EvacTimes;

/**
 * Every tunable number in one payload, so `GET /api/policy` can hand the UI
 * exactly what the engine used. A policy the operator cannot read is a policy
 * they cannot argue with.
 */
export function policySnapshot() {
  return { cleaning: cleaningPolicy, ranking: rankingPolicy, evac: evacTimes };
}
