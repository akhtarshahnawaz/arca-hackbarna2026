import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  ACTION_LABELS,
  describeWind,
  fetchWeather,
  formatMinutes,
  reachCopy,
  spareCopy,
  policySnapshot,
} from "@arca/core";
import type { Context } from "../context.js";
import type { IncidentService } from "../pipeline/incident.js";
import { describeError } from "../logger.js";

/**
 * The agent's tools.
 *
 * Read tools return already-formatted sentences rather than raw records. That
 * is deliberate: handing a model a JSON blob invites it to do arithmetic on the
 * numbers, and arithmetic is exactly what it should not be doing here. The
 * ranking engine has already decided; the model's job is to say it.
 *
 * `propose_call` is the only tool with a side effect, and its side effect is to
 * ask a person. It cannot dial.
 */

export interface ToolDeps {
  ctx: Context;
  incidents: IncidentService;
  /** Sends the approval card. Returns what the coordinator was shown. */
  requestApproval: (input: {
    incidentId: string;
    assetId: string;
    siteName: string;
    reason: string;
  }) => Promise<string>;
}

export function buildTools(deps: ToolDeps) {
  const { ctx, incidents } = deps;

  const listIncidents = createTool({
    id: "list_incidents",
    description:
      "List wildfire incidents ARCA is tracking, newest first, with their confirmation score and status. Use this when asked what is burning or which fires are open.",
    inputSchema: z.object({
      includeClosed: z.boolean().default(false).describe("Include incidents already closed."),
    }),
    outputSchema: z.object({ summary: z.string(), count: z.number() }),
    execute: async (input) => {
      const status = input.includeClosed
        ? undefined
        : ["candidate", "confirmed", "monitoring"];
      const all = await ctx.store.listIncidents(status ? { status } : {});
      if (all.length === 0) return { summary: "No incidents are open.", count: 0 };

      const lines = await Promise.all(
        all.slice(0, 10).map(async (incident) => {
          const sites = await ctx.store.getSites(incident.id);
          const ranked = sites.filter((site) => site.rank > 0);
          const evacuate = ranked.filter((site) => site.action === "EVACUATE_NOW").length;
          return `${incident.name} (${incident.id}): ${incident.status}, confirmation ${incident.confirmation.score}/100, ${ranked.length} sites ranked, ${evacuate} to evacuate now.`;
        }),
      );
      return { summary: lines.join("\n"), count: all.length };
    },
  });

  const getIncident = createTool({
    id: "get_incident",
    description:
      "Details of one incident: how it was confirmed, which satellites saw it, the weather, and what is exposed in total.",
    inputSchema: z.object({ incidentId: z.string() }),
    outputSchema: z.object({ summary: z.string() }),
    execute: async (input) => {
      const incident = await ctx.store.getIncident(input.incidentId);
      if (!incident) return { summary: `No incident with id ${input.incidentId}.` };

      const sites = await ctx.store.getSites(incident.id);
      const ranked = sites.filter((site) => site.rank > 0);
      const exposure = await ctx.store.latestExposure(incident.id);
      const summary = exposure?.summary as Record<string, number | string | null> | undefined;
      const run = await ctx.store.latestSpreadRun(incident.id);

      const lines = [
        `${incident.name} — ${incident.status}, confirmed at ${incident.confirmation.score}/100.`,
        `Evidence: ${incident.confirmation.components.map((component) => `${component.label} ${component.points >= 0 ? "+" : ""}${component.points}`).join(", ")}.`,
        `Satellites: ${incident.confirmation.distinctSources.join(", ") || "unknown"}. ${incident.confirmation.usableHotspots} usable detections, ${incident.confirmation.maskedHotspots} masked as known heat sources.`,
        describeWind(incident.weather),
        run
          ? `Model run: ${run.status}${run.ensembleMembers ? ` with ${run.ensembleMembers} ensemble members` : ""}${run.errorMessage ? ` (${run.errorMessage})` : ""}.`
          : "No model run yet.",
        `${ranked.length} sites ranked. ${summary?.people_estimate ?? 0} people at facilities by registered capacity, ${summary?.population_resident ?? 0} residents in the footprint.`,
      ];
      if (exposure?.warnings?.length) lines.push(`Warnings: ${exposure.warnings.join(" ")}`);
      return { summary: lines.join("\n") };
    },
  });

  const getRankedSites = createTool({
    id: "get_ranked_sites",
    description:
      "The ranked list of sites for an incident, ordered by spare time (soonest to run out first). Use this for 'who do we call first' and 'what is at risk'.",
    inputSchema: z.object({
      incidentId: z.string(),
      limit: z.number().int().min(1).max(25).default(8),
      category: z.string().optional().describe("Filter, e.g. healthcare, education, livestock."),
      actionOnly: z
        .enum(["EVACUATE_NOW", "SHELTER_CANDIDATE", "PREPARE", "EXCLUSION_ZONE", "RESOURCE_AT_RISK", "MONITOR"])
        .optional(),
    }),
    outputSchema: z.object({ summary: z.string(), count: z.number() }),
    execute: async (input) => {
      const sites = await ctx.store.getSites(input.incidentId);
      let ranked = sites.filter((site) => site.rank > 0).map((site) => site.payload);
      if (input.category) {
        const needle = input.category.toLowerCase();
        ranked = ranked.filter(
          (site) => site.category.includes(needle) || site.subcategory.includes(needle),
        );
      }
      if (input.actionOnly) ranked = ranked.filter((site) => site.action === input.actionOnly);
      if (ranked.length === 0) return { summary: "No sites match that.", count: 0 };

      const lines = ranked.slice(0, input.limit).map((site) => {
        const people =
          site.evac.basis === "reported"
            ? `${site.peopleEstimate} reported`
            : `${site.peopleEstimate} registered capacity`;
        const status = site.status === "unnotified" ? "" : ` [${site.status}]`;
        return `${site.rank}. ${site.name} (${site.subcategory.replace(/_/g, " ")}) — ${ACTION_LABELS[site.action]}${status}. ${people}. Arrival ${formatMinutes(site.arrivalMinutes)}, needs ${formatMinutes(site.evac.minutes)}, spare ${formatMinutes(site.spareMinutes)}.`;
      });
      return { summary: lines.join("\n"), count: ranked.length };
    },
  });

  const explainSite = createTool({
    id: "explain_site",
    description:
      "Why one site sits where it does: which model runs reach it, how long it needs to evacuate, what was assumed, and where the figures came from.",
    inputSchema: z.object({ incidentId: z.string(), siteName: z.string() }),
    outputSchema: z.object({ summary: z.string() }),
    execute: async (input) => {
      const sites = await ctx.store.getSites(input.incidentId);
      const needle = input.siteName.toLowerCase();
      const match =
        sites.find((site) => site.payload.name.toLowerCase() === needle) ??
        sites.find((site) => site.payload.name.toLowerCase().includes(needle));
      if (!match) {
        return {
          summary: `No site matching "${input.siteName}". Ask for the ranked list to see the names.`,
        };
      }

      const site = match.payload;
      const lines = [
        `${site.name} — rank ${site.rank || "watch list"}, ${ACTION_LABELS[site.action]}.`,
        reachCopy(site),
        spareCopy(site),
        `Evacuation estimate assumes: ${site.evac.assumptions.join("; ")}.`,
        `People figure is ${site.evac.basis === "reported" ? "reported by phone" : `${site.capacity?.basis ?? "registered capacity"} — a maximum, not live occupancy`}.`,
        site.explanation.actionReason,
      ];
      if (site.provenance.length > 0) {
        lines.push(`Sources: ${site.provenance.map((source) => source.source_id).join(", ")}.`);
      }
      if (site.reported) {
        lines.push(
          `Reported on the phone at ${new Date(site.reported.capturedAt).toISOString().slice(11, 16)}: ${site.reported.peoplePresent ?? "?"} people, ${site.reported.nonAmbulatory ?? "?"} unable to walk unaided.`,
        );
      }
      if (site.valuation?.total_eur) {
        lines.push(
          `Replacement cost estimate ${Math.round(site.valuation.total_eur).toLocaleString("en-GB")} EUR (${site.valuation.method}, triage estimate, not an appraisal).`,
        );
      }
      return { summary: lines.join("\n") };
    },
  });

  const proposeCall = createTool({
    id: "propose_call",
    description:
      "Ask the coordinator to approve a voice call to one site. This does NOT place a call: it sends an approval card, and only the coordinator's approval dials. Use it when a site needs its occupancy confirmed or its recommended action delivered.",
    inputSchema: z.object({
      incidentId: z.string(),
      siteName: z.string(),
      reason: z.string().max(280).describe("One sentence on why this site, now."),
    }),
    outputSchema: z.object({ summary: z.string(), approvalRequested: z.boolean() }),
    // Mastra renders this as an Approve/Deny card in a chat channel. The
    // stored-decision gate in IncidentService is the real enforcement; this is
    // the same answer one layer earlier, where the coordinator can see it.
    requireApproval: true,
    execute: async (input) => {
      const sites = await ctx.store.getSites(input.incidentId);
      const needle = input.siteName.toLowerCase();
      const match =
        sites.find((site) => site.payload.name.toLowerCase() === needle) ??
        sites.find((site) => site.payload.name.toLowerCase().includes(needle));
      if (!match) {
        return { summary: `No site matching "${input.siteName}".`, approvalRequested: false };
      }

      try {
        const shown = await deps.requestApproval({
          incidentId: input.incidentId,
          assetId: match.assetId,
          siteName: match.payload.name,
          reason: input.reason,
        });
        return { summary: shown, approvalRequested: true };
      } catch (error) {
        return {
          summary: `Could not send the approval card: ${describeError(error)}. No call was proposed.`,
          approvalRequested: false,
        };
      }
    },
  });

  const refreshSpread = createTool({
    id: "refresh_spread",
    description:
      "Ask DeepFire for a fresh fire-spread simulation and re-rank on it. Slow: a run can take minutes. Only use it when the fire has visibly changed or the coordinator asks.",
    inputSchema: z.object({ incidentId: z.string() }),
    outputSchema: z.object({ summary: z.string() }),
    execute: async (input) => {
      const incident = await ctx.store.getIncident(input.incidentId);
      if (!incident) return { summary: `No incident with id ${input.incidentId}.` };
      const result = await incidents.process(incident, { force: true, notify: false });
      if (!result.ranking) {
        return { summary: `Could not re-rank: ${result.degraded ?? "no exposure available"}.` };
      }
      return {
        summary: `Re-ran the model and ranked ${result.ranking.totals.sites} sites. ${result.ranking.totals.evacuateNow} to evacuate now.${result.synthetic ? " The model produced nothing usable, so the footprint is a drawn circle, not a prediction." : ""}`,
      };
    },
  });

  const weatherAt = createTool({
    id: "weather_at",
    description: "Wind, gusts and humidity at an incident for the next few hours.",
    inputSchema: z.object({ incidentId: z.string() }),
    outputSchema: z.object({ summary: z.string() }),
    execute: async (input) => {
      const incident = await ctx.store.getIncident(input.incidentId);
      if (!incident) return { summary: `No incident with id ${input.incidentId}.` };
      const weather = await fetchWeather(incident.position);
      return { summary: weather ? describeWind(weather) : "Weather is unavailable right now." };
    },
  });

  const explainPolicy = createTool({
    id: "explain_policy",
    description:
      "The thresholds ARCA uses: confirmation scoring, the probability floor for arrival bands, and the evacuation-time assumptions. Use it when asked why something was or was not confirmed, or where a time estimate comes from.",
    inputSchema: z.object({
      topic: z.enum(["confirmation", "bands", "evacuation", "all"]).default("all"),
    }),
    outputSchema: z.object({ summary: z.string() }),
    execute: async (input) => {
      const policy = policySnapshot();
      const parts: string[] = [];
      if (input.topic === "confirmation" || input.topic === "all") {
        const c = policy.cleaning.confirmation;
        parts.push(
          `Confirmation: a cluster is confirmed at ${c.confirmedAt}/100 and a candidate at ${c.candidateAt}. Points: credible polar detection +${c.credibleDetectionPoints}, two or more satellites +${c.multiSourcePoints}, persistence over ${c.temporalPersistenceMinutes} min +${c.temporalPersistencePoints}, a high-confidence pixel +${c.highConfidencePoints}, strong radiative power +${c.frpStrongPoints}, a fitted perimeter +${c.perimeterPoints}, geostationary-only ${c.geostationaryOnlyPenalty}.`,
        );
      }
      if (input.topic === "bands" || input.topic === "all") {
        parts.push(
          `Arrival bands: cut at ${policy.ranking.probabilityFloor} burn probability, which with ${policy.ranking.ensembleMembers} ensemble members means at least ${Math.round(policy.ranking.probabilityFloor * policy.ranking.ensembleMembers)} runs burned that ground by that hour. Horizon ${policy.ranking.horizonHours} h.`,
        );
      }
      if (input.topic === "evacuation" || input.topic === "all") {
        const care = policy.evac.bySubcategory.care_home;
        parts.push(
          `Evacuation times are stated assumptions, not doctrine. A care home is ${care?.base} min of fixed overhead plus ${care?.perPerson} min per person, with 4 min added for each person reported unable to walk unaided. Livestock is charged per 100 animals by species. Correct these with your own figures.`,
        );
      }
      return { summary: parts.join("\n\n") };
    },
  });

  return {
    list_incidents: listIncidents,
    get_incident: getIncident,
    get_ranked_sites: getRankedSites,
    explain_site: explainSite,
    propose_call: proposeCall,
    refresh_spread: refreshSpread,
    weather_at: weatherAt,
    explain_policy: explainPolicy,
  };
}
