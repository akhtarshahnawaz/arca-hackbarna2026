import type { ProtectiveAction } from "@arca/core";

/**
 * Presentation helpers.
 *
 * The colour table is the single source of truth for what an action looks like
 * anywhere on screen. Duplicating it into the map layer and the list is how a
 * legend ends up lying about what a colour means.
 */

export const ACTION_STYLE: Record<
  ProtectiveAction,
  { label: string; colour: string; short: string; rank: number; help: string }
> = {
  SHELTER_CANDIDATE: {
    label: "Shelter-in-place candidate",
    short: "SHELTER",
    colour: "#60a5fa",
    rank: 5,
    help: "Evacuation probably cannot finish before the fire arrives. Coordinator decides with Bombers.",
  },
  EVACUATE_NOW: {
    label: "Evacuate now",
    short: "EVACUATE",
    colour: "#ef4444",
    rank: 4,
    help: "There is time, but movement has to start now.",
  },
  EXCLUSION_ZONE: {
    label: "Exclusion zone",
    short: "EXCLUSION",
    colour: "#e7e5e4",
    rank: 3,
    help: "Hazardous site in the fire's path. Keep responders and traffic out.",
  },
  RESOURCE_AT_RISK: {
    label: "Resource at risk",
    short: "RESOURCE",
    colour: "#2dd4bf",
    rank: 2,
    help: "Losing this site removes response capacity mid-incident.",
  },
  PREPARE: {
    label: "Prepare",
    short: "PREPARE",
    colour: "#f59e0b",
    rank: 1,
    help: "Warn the site and ready vehicles. Re-check after the next model run.",
  },
  MONITOR: {
    label: "Monitor",
    short: "MONITOR",
    colour: "#64748b",
    rank: 0,
    help: "Below the watch threshold, or already resolved.",
  },
};

/** DeepFire's own probability ramp, so both products read a fire the same way. */
export const BURN_RAMP: Array<[number, string]> = [
  [0.2, "#fef08a"],
  [0.4, "#fbbf24"],
  [0.6, "#f97316"],
  [0.8, "#dc2626"],
  [1.0, "#7f1d1d"],
];

export function burnColour(probability: number): string {
  let colour = BURN_RAMP[0]![1];
  for (const [stop, value] of BURN_RAMP) {
    if (probability >= stop) colour = value;
  }
  return colour;
}

export function minutes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs < 90) return `${sign}${Math.round(abs)}m`;
  const hours = abs / 60;
  return `${sign}${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
}

export function clock(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.round(Math.abs(value));
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function compact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export function euros(value: number | null | undefined): string {
  if (!value) return "—";
  if (value >= 1_000_000_000) return `€${(value / 1_000_000_000).toFixed(1)}bn`;
  if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}k`;
  return `€${Math.round(value)}`;
}

export function areaKm2(m2: number | null | undefined): string {
  if (!m2) return "—";
  const km2 = m2 / 1_000_000;
  return km2 < 10 ? `${km2.toFixed(1)} km²` : `${Math.round(km2)} km²`;
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

export function titleCase(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
