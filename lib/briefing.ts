import { briefingChoices, formatCta } from "./coordinator-cta";
import { corroborationCopy } from "./crosscheck";
import { actionLabel } from "./protective-action";
import { ensembleReachCopy, formatHours, spareTimeCopy } from "./ranking";
import type { CommandState, RankedSite } from "./types";

function siteLine(site: RankedSite): string {
  const animals = site.animals
    .map((animal) => {
      const reported = animal.confirmedCount;
      const cap = animal.registeredCapacity;
      if (reported !== null) {
        return `${animal.species} ${reported} reported (not verified)`;
      }
      return `${animal.species} capacity ${cap ?? "—"} (registry only)`;
    })
    .join(", ");

  const truck =
    site.hasOwnTransport === null
      ? "truck unknown"
      : site.hasOwnTransport
        ? "has transport / truck"
        : "no own truck";

  // Rank 1 is not always the site with least spare time — a corroborated fire
  // pins a site above the clock — so a pinned row says why it is where it is.
  const agree = corroborationCopy(site);

  return [
    `${site.rank}. ${site.code} · ${site.kind} · ${site.municipality}`,
    ...(agree ? [`   PINNED BY CROSS-CHECK: ${agree}`] : []),
    `   ${ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival)}`,
    `   Spare ${site.spareTime === null ? "—" : formatHours(site.spareTime)} · ${spareTimeCopy(site.spareTime)}`,
    `   ${animals || "no animals on file"} · ${truck}`,
    `   Decision: ${site.protectiveAction ? actionLabel[site.protectiveAction] : "none — call locked"}`,
    `   ARCA calls only after Confine or Evacuate, and only after the Approve button. Typing Call is not approval. Shelter (coordinator config, not OSM): ${site.shelterHint}`,
  ].join("\n");
}

export function formatCoordinatorBriefing(state: CommandState): string {
  const ranked = state.sites.map(siteLine).join("\n\n");
  const watch = state.watch
    .slice(0, 3)
    .map(
      (site) =>
        `– ${site.code} · ${ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival)} (watch, not ranked)`,
    )
    .join("\n");

  return [
    "Alert: Font-rubí / demo fire",
    `${state.fire.name} · ${state.fire.municipality}`,
    `Simulation: ${state.fire.mode.toUpperCase()} ensemble, ${state.fire.ensembleMembers} members, ${state.fire.horizonHours} h horizon. Hour polygons on the map are DEMO — not a live Deepfire perimeter.`,
    state.contactPolicy?.dashboardLabel ?? "Contact policy: human approval required.",
    "Formula ranks this list. You do not tap-rank it. LLM explains. One Approve covers the Voice retry plan (max 3). Do not ask for a second Approve to retry.",
    "Call the farm yourself, or request a call then tap Approve. Typing Call is not approval.",
    "",
    "Ranked (likely + possible only; filter then spare time). A hotspot two feeds agree on pins its site above the clock — those rows say so:",
    ranked || "No likely or possible sites.",
    "",
    "Watch (below 3/10 — cannot win rank 1):",
    watch || "None.",
    "",
    "Log a farmer reply as reported, not verified: “farmer says 200 sheep, has a truck”. Ranking will recalculate.",
    "Resident mass-alert needs Approve. If you wait 30 minutes, we escalate — we do not blast.",
    "",
    formatCta(briefingChoices()).choiceList,
  ].join("\n");
}

export function formatResidentAlert(site: {
  fireWindow: string;
  shelterHint: string;
  municipality?: string;
}): string {
  return [
    "ARCA wildfire notice (coordinator approved).",
    site.municipality ? `Area: ${site.municipality}.` : null,
    site.fireWindow,
    "Stay inside. Bring dogs and other animals in. Close doors and windows.",
    `Shelter that takes pets (coordinator config, not live OSM): ${site.shelterHint}`,
    "Residents are warned only after a human Approves.",
  ]
    .filter(Boolean)
    .join("\n");
}
