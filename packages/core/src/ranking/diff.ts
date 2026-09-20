import type { RankedSite, RankingDiff, RankingDiffEntry, RankingResult } from "../domain/types.js";
import { formatMinutes } from "./rank.js";

/**
 * What changed between two rankings, in words a coordinator can act on.
 *
 * A re-rank that silently reshuffles the screen is worse than no re-rank: the
 * person watching has to re-read the whole list to find out whether anything
 * moved. This produces the short diff the agent sends to Telegram and the UI
 * shows as a toast — and it only reports movements that matter, because "moved
 * from 14 to 15" is noise.
 */
export function rankingDiff(
  previous: RankingResult | null,
  next: RankingResult,
  options: { minRankMove?: number; topN?: number; alwaysReportTopN?: number } = {},
): RankingDiff {
  const minMove = options.minRankMove ?? 2;
  const topN = options.topN ?? 10;
  // Any movement at the very top is reported however small. Becoming the site
  // that runs out of time first is the single most important thing that can
  // change, and a one-place move into first is exactly that — filtering it as
  // a small move hid the swap the phone call had just caused.
  const alwaysTop = options.alwaysReportTopN ?? 3;

  if (!previous) {
    return {
      fromVersion: 0,
      toVersion: next.version,
      entries: [],
      summary: `First ranking: ${next.ranked.length} sites, ${next.totals.evacuateNow} to evacuate now.`,
    };
  }

  const before = new Map<string, RankedSite>();
  for (const site of [...previous.ranked, ...previous.watch]) before.set(site.id, site);

  const entries: RankingDiffEntry[] = [];

  for (const site of next.ranked) {
    const old = before.get(site.id);

    if (!old || old.rank === 0) {
      if (site.rank <= topN) {
        entries.push({
          siteId: site.id,
          name: site.name,
          fromRank: old?.rank ?? null,
          toRank: site.rank,
          fromAction: old?.action ?? null,
          toAction: site.action,
          reason: old
            ? `Moved onto the main list at #${site.rank}.`
            : `New in the ranked list at #${site.rank}.`,
        });
      }
      continue;
    }

    const actionChanged = old.action !== site.action;
    const movedUp = old.rank - site.rank >= minMove && site.rank <= topN;
    const movedAtTop = old.rank !== site.rank && Math.min(old.rank, site.rank) <= alwaysTop;

    if (!actionChanged && !movedUp && !movedAtTop) continue;

    entries.push({
      siteId: site.id,
      name: site.name,
      fromRank: old.rank,
      toRank: site.rank,
      fromAction: old.action,
      toAction: site.action,
      reason: explainMove(old, site),
    });
  }

  entries.sort((a, b) => (a.toRank ?? 999) - (b.toRank ?? 999));

  return {
    fromVersion: previous.version,
    toVersion: next.version,
    entries,
    summary: summarise(entries, next),
  };
}

function explainMove(old: RankedSite, next: RankedSite): string {
  const parts: string[] = [];

  if (old.evac.basis !== "reported" && next.evac.basis === "reported") {
    parts.push(
      `reported ${next.evac.people} people on site instead of ${old.evac.people} registered`,
    );
    const nonAmbulatory = next.reported?.nonAmbulatory;
    if (nonAmbulatory) parts.push(`${nonAmbulatory} unable to walk unaided`);
  }

  if (old.evac.minutes !== next.evac.minutes) {
    parts.push(
      `evacuation need ${formatMinutes(old.evac.minutes)} → ${formatMinutes(next.evac.minutes)}`,
    );
  }

  if (old.arrivalMinutes !== next.arrivalMinutes) {
    parts.push(
      `arrival ${formatMinutes(old.arrivalMinutes)} → ${formatMinutes(next.arrivalMinutes)}`,
    );
  }

  if (old.reach.runsReaching !== next.reach.runsReaching) {
    parts.push(
      `${old.reach.runsReaching}/${old.reach.runsTotal} → ${next.reach.runsReaching}/${next.reach.runsTotal} runs reaching`,
    );
  }

  const head =
    old.rank !== next.rank ? `#${old.rank} → #${next.rank}` : `stays at #${next.rank}`;
  const action = old.action !== next.action ? `, now ${labelOf(next.action)}` : "";
  const because = parts.length > 0 ? `: ${parts.join("; ")}` : "";

  return `${head}${action}${because}.`;
}

function labelOf(action: RankedSite["action"]): string {
  return action.toLowerCase().replace(/_/g, " ");
}

function summarise(entries: RankingDiffEntry[], next: RankingResult): string {
  if (entries.length === 0) return "Ranking unchanged.";
  const first = entries[0];
  if (!first) return "Ranking unchanged.";
  const rest = entries.length - 1;
  const tail = rest > 0 ? ` and ${rest} other change${rest === 1 ? "" : "s"}` : "";
  return `${first.name} ${first.reason.replace(/\.$/, "")}${tail}. ${next.totals.evacuateNow} sites to evacuate now.`;
}
