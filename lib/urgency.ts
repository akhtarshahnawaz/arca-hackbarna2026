import type { RankedSite } from "./types";
import { watchCut } from "./ranking-policy";

/**
 * Urgency is a measurement: how soon this site runs out of time.
 * It never chooses monitor, confine, or evacuate. The coordinator does.
 */
export type UrgencyTier = "late" | "now" | "prepare" | "none";

export function urgencyTier(site: RankedSite): UrgencyTier {
  if (site.spareTime === null || site.label === "watch") return "none";
  if (site.spareTime < 0) return "late";
  if (site.spareTime <= 1.5) return "now";
  return "prepare";
}

export const urgencyBadgeLabel: Record<UrgencyTier, string> = {
  late: "MOST URGENT",
  now: "URGENT",
  prepare: "LESS URGENT",
  none: "NOT CLOSE",
};

/** "1 h 30 min", "45 min", "3 h" — no decimals, no minus signs. */
export function plainDuration(hours: number): string {
  const totalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function likelihoodWord(runsReach: number, ensembleMembers: number): string {
  const p = ensembleMembers > 0 ? runsReach / ensembleMembers : 0;
  const cut = watchCut(ensembleMembers);
  if (p >= 0.9) return "almost certain";
  if (p >= 0.7) return "likely";
  if (p >= cut) return "possible";
  return "unlikely";
}

/** One line under the site name: when the fire comes vs how long they need. */
export function urgencyRowCopy(site: RankedSite): string {
  if (site.tArrival === null) {
    return "Fire is not expected to reach here soon.";
  }
  return `Fire ${likelihoodWord(site.runsReach, site.ensembleMembers)} in ~${plainDuration(
    site.tArrival,
  )} · they need ${plainDuration(site.tEvac)} to leave`;
}

/** Right-hand chip: how much time is left. A clock, not an order. */
export function timeLeftCopy(site: RankedSite): string {
  if (site.spareTime === null) return "Not close yet";
  if (site.spareTime < 0) return `Late by ${plainDuration(site.spareTime)}`;
  if (site.spareTime === 0) return "No time to spare";
  return `${plainDuration(site.spareTime)} to spare`;
}

/** What the clocks mean. Never an order to leave or stay. */
export function urgencySituationCopy(site: RankedSite): string {
  const tier = urgencyTier(site);
  if (tier === "late") {
    return `Check this one first. The fire gets there about ${plainDuration(
      site.spareTime ?? 0,
    )} before they can finish leaving. Leaving late can be more dangerous than staying inside. You decide — ARCA does not.`;
  }
  if (tier === "now") {
    return `Urgent, but they can still finish leaving. About ${plainDuration(
      site.spareTime ?? 0,
    )} of margin. Check it after the red ones. You decide whether they go or stay.`;
  }
  if (tier === "prepare") {
    return `Less urgent. About ${plainDuration(
      site.spareTime ?? 0,
    )} of margin. Look after the red and orange sites. You still decide.`;
  }
  return "Not close. The fire is not expected here soon. Nothing to order. You can still mark monitor or latent.";
}
