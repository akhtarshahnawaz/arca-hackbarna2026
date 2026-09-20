import {
  ACTION_LABELS,
  describeWind,
  formatMinutes,
  reachCopy,
  type Incident,
  type RankingResult,
} from "@arca/core";
import { nebius, type ChatMessage } from "./nebius.js";
import { env } from "../env.js";
import { describeError } from "../logger.js";

/**
 * The briefing a coordinator reads on their phone.
 *
 * Every number in it is computed before the model is called, and the model is
 * given them as facts it may only rephrase. That is the rule that keeps this
 * safe to send unprompted: the language is generated, the content is not. If
 * Nebius is unreachable or returns something unusable, the deterministic
 * template below goes out instead — a plainer briefing is a complete fallback,
 * whereas no briefing is a missed fire.
 */

const SYSTEM_PROMPT = `You write the first message a wildfire coordinator sees on their phone.

Rules:
- Six lines maximum. One idea per line. No headings, no bullets, no markdown tables.
- Use only the figures given to you. Never add, round differently, or infer a number.
- Lead with what has to be decided, not with what was detected.
- Say "registered capacity" when a figure is registered and "reported" when a site said it on the phone.
- Never say a site has been contacted, evacuated or warned. You do not know that.
- Plain language a tired person can read at 3 a.m. No drama, no adjectives.
- End with the single most urgent site and why it is first.`;

export interface BriefingInput {
  incident: Incident;
  ranking: RankingResult;
  degraded?: string | null;
  synthetic?: boolean;
}

export interface Briefing {
  text: string;
  generated: boolean;
  model: string | null;
}

export async function buildBriefing(input: BriefingInput): Promise<Briefing> {
  const facts = collectFacts(input);
  const fallback = renderTemplate(input, facts);

  if (!nebius.configured) return { text: fallback, generated: false, model: null };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "Write the briefing from these facts. Use no others.",
        "",
        JSON.stringify(facts, null, 2),
      ].join("\n"),
    },
  ];

  try {
    const result = await nebius.complete(messages, { temperature: 0.3, maxTokens: 400 });
    const text = result.content.trim();
    // A briefing that came back empty, enormous, or full of markdown furniture
    // is worse than the template. The template is already correct.
    if (!text || text.length > 1200 || text.includes("|")) {
      return { text: fallback, generated: false, model: result.model };
    }
    return { text: prefix(text), generated: true, model: result.model };
  } catch (error) {
    return { text: fallback, generated: false, model: `unavailable: ${describeError(error)}` };
  }
}

function collectFacts(input: BriefingInput) {
  const { incident, ranking } = input;
  const top = ranking.ranked.slice(0, 5).map((site) => ({
    rank: site.rank,
    name: site.name,
    type: site.subcategory.replace(/_/g, " "),
    action: ACTION_LABELS[site.action],
    people: site.peopleEstimate,
    peopleBasis: site.evac.basis,
    arrival: formatMinutes(site.arrivalMinutes),
    evacuationNeed: formatMinutes(site.evac.minutes),
    spareTime: formatMinutes(site.spareMinutes),
    runs: `${site.reach.runsReaching} of ${site.reach.runsTotal}`,
  }));

  return {
    fire: incident.name,
    confirmationScore: `${incident.confirmation.score} of 100`,
    satellites: incident.confirmation.distinctSources.join(", ") || "unknown",
    usableDetections: incident.confirmation.usableHotspots,
    maskedDetections: incident.confirmation.maskedHotspots,
    weather: describeWind(incident.weather),
    horizonHours: env.watch.horizonHours,
    totals: {
      sitesExposed: ranking.totals.sites,
      peopleAtFacilities: ranking.totals.peopleAtFacilities,
      residentsInFootprint: ranking.totals.populationResident,
      livestockUnits: ranking.totals.livestockUnits,
      evacuateNow: ranking.totals.evacuateNow,
      shelterCandidates: ranking.totals.shelterCandidates,
      hazardousSites: ranking.totals.hazardous,
    },
    topSites: top,
    caveats: [
      "Capacity figures are registered maximums, not live occupancy.",
      input.synthetic
        ? "No model run succeeded: the footprint is a drawn circle, not a prediction."
        : null,
      input.degraded ? `Exposure was served in ${input.degraded.replace(/_/g, " ")} mode.` : null,
      env.safety.exerciseMode ? "This is an exercise." : null,
    ].filter(Boolean),
  };
}

/**
 * The deterministic briefing.
 *
 * Not a degraded mode so much as the reference version: it contains exactly the
 * same facts the model is given, in a fixed order. Everything the model adds is
 * phrasing.
 */
function renderTemplate(input: BriefingInput, facts: ReturnType<typeof collectFacts>): string {
  const first = input.ranking.ranked[0];
  const lines: string[] = [];

  lines.push(
    `${facts.fire}: ${facts.totals.evacuateNow} site${
      facts.totals.evacuateNow === 1 ? "" : "s"
    } to evacuate now, ${facts.totals.shelterCandidates} already out of time.`,
  );
  lines.push(
    `${facts.totals.sitesExposed} sites exposed in the next ${facts.horizonHours} h: ${facts.totals.peopleAtFacilities} people at facilities (registered capacity), ${facts.totals.residentsInFootprint} residents in the footprint.`,
  );
  if (facts.totals.livestockUnits > 0) {
    lines.push(`${facts.totals.livestockUnits} livestock units, which cannot self-evacuate.`);
  }
  lines.push(
    `Confirmed at ${facts.confirmationScore} from ${facts.satellites}. ${facts.maskedDetections} detection${
      facts.maskedDetections === 1 ? "" : "s"
    } masked as known heat sources.`,
  );
  lines.push(facts.weather);

  const topFact = facts.topSites[0];
  if (first && topFact) {
    lines.push(
      `First: ${first.name}. ${reachCopy(first)} It needs ${topFact.evacuationNeed} to empty, leaving ${topFact.spareTime}.`,
    );
  }
  for (const caveat of facts.caveats) if (caveat) lines.push(caveat);

  return prefix(lines.join("\n"));
}

function prefix(text: string): string {
  return env.safety.exerciseMode ? `SIMULACRO / EXERCISE\n\n${text}` : text;
}
