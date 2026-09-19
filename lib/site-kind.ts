import type { SiteKind } from "./types";

export function siteKindLabel(kind: SiteKind): string {
  if (kind === "care_home") return "Care home";
  if (kind === "cap") return "Primary care (CAP)";
  if (kind === "hospital") return "Hospital";
  if (kind === "school") return "School";
  if (kind === "farm") return "Farm";
  return "Household";
}

/** Filled badges — shared by list rows and the in-place expand. */
export const siteKindBadgeClass: Record<SiteKind, string> = {
  care_home: "border-transparent bg-violet-600 text-white",
  cap: "border-transparent bg-teal-600 text-white",
  hospital: "border-transparent bg-rose-600 text-white",
  school: "border-transparent bg-sky-600 text-white",
  farm: "border-transparent bg-emerald-700 text-white",
  household: "border-transparent bg-amber-600 text-white",
};

/** Leaflet fills — same hues as the badges. */
export const siteKindMarkerColor: Record<SiteKind, string> = {
  care_home: "#7c3aed",
  cap: "#0d9488",
  hospital: "#e11d48",
  school: "#0284c7",
  farm: "#047857",
  household: "#d97706",
};

/** Same hues, lighter — forest and burned ground swallow the map fills. */
export const siteKindSatelliteColor: Record<SiteKind, string> = {
  care_home: "#c4b5fd",
  cap: "#5eead4",
  hospital: "#fb7185",
  school: "#7dd3fc",
  farm: "#6ee7b7",
  household: "#fcd34d",
};
