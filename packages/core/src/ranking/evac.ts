import { evacTimes } from "../config/index.js";
import type {
  EvacEstimate,
  ExposureAsset,
  PeopleBasis,
  SiteReport,
} from "../domain/types.js";

/**
 * How long it takes to empty a site.
 *
 * This is the half of the equation that nobody publishes. Fire models are
 * everywhere; how long it takes to get sixty-four dependent residents out of a
 * care home at two in the morning is institutional knowledge. The numbers here
 * are stated assumptions, versioned in config, surfaced in the API and repeated
 * in every explanation, so the first thing a fire officer does with this system
 * is correct them — which is the point.
 */

export interface EvacInput {
  subcategory: string;
  category: string;
  capacityPeople?: number | null;
  capacityBasis?: string | null;
  livestockUnits?: number | null;
  livestockSpecies?: Array<{ species: string; count: number }>;
  reported?: SiteReport | null;
}

/** Reported beats registered beats a class default. Always say which. */
export function resolvePeople(input: EvacInput): { people: number; basis: PeopleBasis } {
  const reported = input.reported?.peoplePresent;
  if (reported !== null && reported !== undefined && Number.isFinite(reported)) {
    return { people: Math.max(0, reported), basis: "reported" };
  }
  const registered = input.capacityPeople;
  if (registered !== null && registered !== undefined && Number.isFinite(registered) && registered > 0) {
    return { people: registered, basis: "registered" };
  }
  return { people: 0, basis: input.capacityPeople === 0 ? "registered" : "unknown" };
}

function livestockMinutes(input: EvacInput): { minutes: number; assumptions: string[] } {
  const config = evacTimes.livestock;
  const assumptions: string[] = [];

  const reported = input.reported?.livestockPresent;
  const species = input.livestockSpecies ?? [];

  if (species.length > 0) {
    let minutes = 0;
    for (const entry of species) {
      const key = entry.species.toLowerCase();
      const rate =
        Object.entries(config.per100BySpecies).find(([name]) => key.includes(name))?.[1] ??
        config.per100Default;
      minutes += (entry.count / 100) * rate;
      assumptions.push(`${entry.count} ${entry.species} at ${rate} min per 100`);
    }
    return { minutes: Math.min(minutes, config.maxMinutes), assumptions };
  }

  const units = reported ?? input.livestockUnits ?? 0;
  if (units <= 0) return { minutes: 0, assumptions };

  const minutes = Math.min((units / 100) * config.per100Default, config.maxMinutes);
  assumptions.push(
    `${units} livestock units at ${config.per100Default} min per 100 (${
      reported != null ? "reported by phone" : "registry capacity"
    })`,
  );
  if (minutes >= config.maxMinutes) assumptions.push(config.maxMinutesNote);
  return { minutes, assumptions };
}

export function estimateEvacMinutes(input: EvacInput): EvacEstimate {
  const entry =
    evacTimes.bySubcategory[input.subcategory] ??
    evacTimes.bySubcategory[input.category] ??
    evacTimes.default;

  const { people, basis } = resolvePeople(input);
  const assumptions: string[] = [];

  const base = entry.base;
  const perPerson = entry.perPerson * people;
  assumptions.push(`${base} min fixed overhead for ${input.subcategory.replace(/_/g, " ")}`);
  if (perPerson > 0) {
    assumptions.push(
      `${entry.perPerson} min per person × ${people} (${describeBasis(basis, input)})`,
    );
  }
  if (entry.note) assumptions.push(entry.note);

  const livestock = livestockMinutes(input);
  assumptions.push(...livestock.assumptions);

  // Non-ambulatory occupants dominate a care-home evacuation, so a reported
  // count of them outweighs the per-person average it replaces.
  let mobilityPenalty = 0;
  const nonAmbulatory = input.reported?.nonAmbulatory;
  if (nonAmbulatory != null && nonAmbulatory > 0) {
    mobilityPenalty = nonAmbulatory * 4;
    assumptions.push(
      `${nonAmbulatory} reported unable to walk unaided, at 4 min each for stretcher or chair transfer`,
    );
  }

  // People only. Livestock is returned alongside rather than folded in; see
  // the note on EvacEstimate.livestockMinutes for why that distinction is
  // load-bearing rather than pedantic.
  const total = Math.min(
    Math.round(base + perPerson + mobilityPenalty),
    evacTimes.maxMinutes,
  );

  return {
    minutes: total,
    livestockMinutes: Math.round(livestock.minutes),
    basis,
    people,
    assumptions,
  };
}

function describeBasis(basis: PeopleBasis, input: EvacInput): string {
  if (basis === "reported") return "reported by phone";
  if (basis === "registered") return input.capacityBasis ?? "registered capacity";
  return "no occupancy figure available";
}

/** Livestock units carried on a Talaia asset, when the registry supplied them. */
export function livestockUnitsOf(asset: ExposureAsset): number | null {
  const capacity = asset.capacity as (Record<string, unknown> & { places?: number }) | null;
  if (!capacity) return null;
  const direct = capacity["livestock_units"];
  if (typeof direct === "number") return direct;
  if (asset.category === "livestock" && typeof capacity.places === "number") return capacity.places;
  return null;
}
