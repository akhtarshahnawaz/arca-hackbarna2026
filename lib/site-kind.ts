import type { SiteKind } from "./types";

export function siteKindLabel(kind: SiteKind): string {
  if (kind === "care_home") return "Care home";
  if (kind === "hospital") return "Hospital";
  if (kind === "school") return "School";
  if (kind === "farm") return "Farm";
  return "Household";
}

/** Filled badges — shared by list rows and the in-place expand. */
export const siteKindBadgeClass: Record<SiteKind, string> = {
  care_home: "border-transparent bg-violet-600 text-white",
  hospital: "border-transparent bg-rose-600 text-white",
  school: "border-transparent bg-sky-600 text-white",
  farm: "border-transparent bg-emerald-700 text-white",
  household: "border-transparent bg-amber-600 text-white",
};

/** Leaflet fills — same hues as the badges. */
export const siteKindMarkerColor: Record<SiteKind, string> = {
  care_home: "#7c3aed",
  hospital: "#e11d48",
  school: "#0284c7",
  farm: "#047857",
  household: "#d97706",
};
