import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { policySnapshot, type SiteStatus } from "@arca/core";
import type { Context as ArcaContext } from "../context.js";
import type { IncidentService } from "../pipeline/incident.js";
import type { ReplayService } from "../pipeline/replay.js";
import type { Watcher } from "../pipeline/watcher.js";
import type { CoordinatorAgent } from "../agent/coordinator.js";
import type { TelegramBot } from "../telegram/bot.js";
import { bus } from "../bus.js";
import { env, capabilities } from "../env.js";
import { describeError } from "../logger.js";

/**
 * The HTTP surface.
 *
 * Read endpoints for the ops UI, one write endpoint for decisions, and a
 * server-sent event stream so the screen moves as work happens. The decision
 * endpoint is the same one the Telegram button calls, which is what keeps a
 * single audit trail no matter where the approval came from.
 */

export interface ServerDeps {
  ctx: ArcaContext;
  incidents: IncidentService;
  replay: ReplayService;
  watcher: Watcher | null;
  agent: CoordinatorAgent;
  telegram: TelegramBot | null;
}

export function createApp(deps: ServerDeps) {
  const { ctx, incidents, replay, watcher, agent, telegram } = deps;
  const app = new Hono();

  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "authorization", "x-ops-token"] }));

  /**
   * A shared token, checked in constant time.
   *
   * Not an identity system: this is one deployment for one operations room.
   * What it does provide is the difference between "anyone who finds the URL"
   * and "someone the team gave the token to", which is the gap that matters
   * when the payload includes facility phone numbers.
   */
  app.use("/api/*", async (c, next) => {
    const open = ["/api/health", "/api/telegram/webhook"];
    if (!env.opsToken || open.some((path) => c.req.path.startsWith(path))) return next();

    const provided =
      c.req.header("x-ops-token") ??
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
      new URL(c.req.url).searchParams.get("token") ??
      "";
    if (!timingSafeEqual(provided, env.opsToken)) {
      return c.json({ error: "unauthorised" }, 401);
    }
    return next();
  });

  // ---------------------------------------------------------------------------
  // Health and capability
  // ---------------------------------------------------------------------------

  app.get("/api/health", async (c) => {
    const caps = capabilities();
    const [deepfireOk, talaiaOk] = await Promise.all([
      ctx.deepfire ? ctx.deepfire.ping() : Promise.resolve(false),
      ctx.talaia ? ctx.talaia.health() : Promise.resolve(false),
    ]);
    const healthy = !caps.deepfire || deepfireOk;
    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        storage: ctx.store.kind,
        capabilities: caps,
        upstream: { deepfire: deepfireOk, talaia: talaiaOk },
        exerciseMode: env.safety.exerciseMode,
        at: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    );
  });

  app.get("/api/policy", (c) => c.json(policySnapshot()));

  // ---------------------------------------------------------------------------
  // The live feed — every active cluster, including the rejected ones
  // ---------------------------------------------------------------------------

  /**
   * What is burning right now.
   *
   * Returns every active cluster in the area of interest with the confirmation
   * score attached, not only the ones that cleared the bar. Showing the
   * rejects is the point: a coordinator who cannot see what the system threw
   * away has no way to judge whether it is throwing away the right things.
   *
   * Served from a short cache, so an open screen may poll this freely.
   * `?force=true` is the "scan now" button and bypasses it.
   */
  app.get("/api/clusters", async (c) => {
    if (!watcher) {
      return c.json({
        clusters: [],
        bbox: env.watch.bbox,
        areaId: null,
        areaLabel: null,
        coverage: "osm",
        at: new Date().toISOString(),
        error: "DeepFire is not configured, so there is no live feed. Use a synthetic scenario.",
        maskIncomplete: true,
        areas: [],
      });
    }
    const survey = await watcher.survey({
      force: c.req.query("force") === "true",
      area: c.req.query("area"),
    });
    // The areas ride along with the feed so the picker cannot offer one the
    // agent would not accept.
    return c.json({ ...survey, areas: watcher.areas() });
  });

  /**
   * Work this cluster.
   *
   * Opens an incident for a cluster the watcher may not have opened on its own
   * and starts the pipeline on it. The pipeline is deliberately not awaited: a
   * simulation takes minutes, and the screen should show the incident
   * immediately and fill in as work completes over the event stream.
   */
  app.post("/api/clusters/:id/adopt", async (c) => {
    if (!watcher) return c.json({ error: "DeepFire is not configured" }, 400);
    try {
      const incident = await watcher.adopt(c.req.param("id"));
      if (!incident) {
        return c.json({ error: "That cluster is no longer in the live feed." }, 404);
      }
      return c.json({ ok: true, incidentId: incident.id, incident });
    } catch (error) {
      return c.json({ error: describeError(error) }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Incidents
  // ---------------------------------------------------------------------------

  app.get("/api/incidents", async (c) => {
    const includeClosed = c.req.query("includeClosed") === "true";
    const list = await ctx.store.listIncidents(
      includeClosed ? {} : { status: ["candidate", "confirmed", "monitoring"] },
    );
    const withCounts = await Promise.all(
      list.map(async (incident) => {
        const sites = await ctx.store.getSites(incident.id);
        const ranked = sites.filter((site) => site.rank > 0);
        return {
          ...incident,
          counts: {
            ranked: ranked.length,
            evacuateNow: ranked.filter((site) => site.action === "EVACUATE_NOW").length,
            shelterCandidates: ranked.filter((site) => site.action === "SHELTER_CANDIDATE").length,
            people: ranked.reduce((sum, site) => sum + site.payload.peopleEstimate, 0),
          },
        };
      }),
    );
    return c.json({ incidents: withCounts });
  });

  /**
   * Everything one screen needs, in one response.
   *
   * Deliberately not split into six endpoints: the map, the ranked list, the
   * timeline and the header all describe the same moment, and fetching them
   * separately would let the map show one ranking version while the list shows
   * another. One payload, one consistent view.
   */
  app.get("/api/incidents/:id", async (c) => {
    const id = c.req.param("id");
    const incident = await ctx.store.getIncident(id);
    if (!incident) return c.json({ error: "not found" }, 404);

    const [sites, timeline, run, exposure, calls, diffs, hotspots] = await Promise.all([
      ctx.store.getSites(id),
      ctx.store.getTimeline(id, 300),
      ctx.store.latestSpreadRun(id),
      ctx.store.latestExposure(id),
      ctx.store.listCalls(id),
      ctx.store.listRankingDiffs(id),
      ctx.store.getHotspots(id),
    ]);

    return c.json({
      incident,
      hotspots,
      spread: run
        ? {
            id: run.id,
            status: run.status,
            simulationId: run.simulationId,
            bands: run.bands,
            frames: run.frames,
            windSpeedMs: run.windSpeedMs,
            windDirectionDeg: run.windDirectionDeg,
            burnedAreaM2: run.burnedAreaM2,
            ensembleMembers: run.ensembleMembers,
            errorMessage: run.errorMessage,
            // A drawn-circle fallback must be labelled wherever it is consumed.
            synthetic: run.status !== "COMPLETED",
            // And "the model has not answered yet" is a different thing to say
            // than "the model failed": one resolves itself, the other does not.
            provisional: run.status === "PROVISIONAL",
          }
        : null,
      exposure: exposure
        ? {
            summary: exposure.summary,
            bands: exposure.bands,
            population: exposure.population,
            warnings: exposure.warnings,
            degraded: exposure.degraded,
          }
        : null,
      sites: sites.map((site) => site.payload),
      calls,
      timeline,
      diffs,
    });
  });

  app.post("/api/incidents/:id/refresh", async (c) => {
    const incident = await ctx.store.getIncident(c.req.param("id"));
    if (!incident) return c.json({ error: "not found" }, 404);
    const force = c.req.query("force") === "true";
    const result = await incidents.process(incident, { force, notify: false });
    return c.json({
      ok: true,
      ranked: result.ranking?.ranked.length ?? 0,
      degraded: result.degraded,
      synthetic: result.synthetic,
    });
  });

  // ---------------------------------------------------------------------------
  // Decisions — the only way anything irreversible happens
  // ---------------------------------------------------------------------------

  app.post("/api/incidents/:id/decisions", async (c) => {
    const incidentId = c.req.param("id");
    const body = await c.req.json<{
      kind: "approve_call" | "deny" | "set_status" | "note";
      assetId?: string;
      status?: SiteStatus;
      actor?: string;
      note?: string;
      language?: "es" | "ca" | "en";
    }>();

    const actor = body.actor?.trim() || "ops-ui";

    try {
      switch (body.kind) {
        case "approve_call": {
          if (!body.assetId) return c.json({ error: "assetId required" }, 400);
          const result = await incidents.dispatchApprovedCall({
            incidentId,
            assetId: body.assetId,
            actor,
            via: "web",
            language: body.language,
          });
          return c.json({ ok: true, message: result.message, call: result.call });
        }
        case "deny": {
          if (!body.assetId) return c.json({ error: "assetId required" }, 400);
          await incidents.recordDecision({
            incidentId,
            siteId: body.assetId,
            kind: "deny",
            actor,
            via: "web",
            note: body.note,
          });
          await ctx.timeline(incidentId, "denied", `${actor} denied the call.`, { actor });
          return c.json({ ok: true, message: "Denied. Nothing was dialled." });
        }
        case "set_status": {
          if (!body.assetId || !body.status) return c.json({ error: "assetId and status required" }, 400);
          await incidents.setSiteStatus({
            incidentId,
            assetId: body.assetId,
            status: body.status,
            actor,
            via: "web",
            note: body.note,
          });
          return c.json({ ok: true, message: `Set to ${body.status}.` });
        }
        case "note": {
          await incidents.recordDecision({
            incidentId,
            kind: "note",
            actor,
            via: "web",
            note: body.note,
          });
          await ctx.timeline(incidentId, "note", body.note ?? "Note added.", { actor });
          return c.json({ ok: true });
        }
        default:
          return c.json({ error: "unknown decision kind" }, 400);
      }
    } catch (error) {
      return c.json({ error: describeError(error) }, 500);
    }
  });

  /** Paste a transcript by hand: the workflow without working telephony. */
  app.post("/api/incidents/:id/transcript", async (c) => {
    const body = await c.req.json<{ assetId: string; transcript: string }>();
    if (!body.assetId || !body.transcript) {
      return c.json({ error: "assetId and transcript required" }, 400);
    }
    try {
      const result = await incidents.applyTranscript({
        incidentId: c.req.param("id"),
        assetId: body.assetId,
        transcript: body.transcript,
        source: "manual",
      });
      return c.json({ ok: true, ...result });
    } catch (error) {
      return c.json({ error: describeError(error) }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  app.post("/api/chat", async (c) => {
    const body = await c.req.json<{
      message: string;
      conversationId?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    }>();
    if (!body.message?.trim()) return c.json({ error: "message required" }, 400);
    const answer = await agent.ask({
      message: body.message,
      conversationId: body.conversationId ?? "web",
      history: body.history,
    });
    return c.json(answer);
  });

  // ---------------------------------------------------------------------------
  // Replay and watcher
  // ---------------------------------------------------------------------------

  app.get("/api/replay", async (c) => c.json({ bundles: await replay.list() }));

  /** The synthetic scenarios, described well enough to choose between them. */
  app.get("/api/scenarios", async (c) => c.json({ scenarios: await replay.catalogue() }));

  /**
   * Start a scenario.
   *
   * The same code path as a live incident from the moment the bundle is loaded
   * — same cleaning, same banding, same ranking — which is what makes a
   * scenario worth showing rather than a mock-up.
   */
  app.post("/api/scenarios/:name/start", async (c) => {
    const asOf = c.req.query("asOf") ?? undefined;
    const incident = await replay.start(c.req.param("name"), asOf ? { asOf } : {});
    if (!incident) return c.json({ error: "no such scenario" }, 404);

    // Deliberately not awaited. The detections and the recorded model run are
    // already stored, so the screen has something to draw immediately; the
    // exposure query behind this can take a minute when Talaia is slow, and a
    // button that stays pressed for that long reads as a hang.
    void incidents.process(incident, { notify: false }).catch((error) => {
      ctx.log.error("Scenario pipeline failed", {
        incidentId: incident.id,
        error: describeError(error),
      });
    });

    return c.json({ ok: true, incidentId: incident.id, confirmation: incident.confirmation });
  });

  app.post("/api/replay/:name", async (c) => {
    const asOf = c.req.query("asOf") ?? undefined;
    const incident = await replay.start(c.req.param("name"), asOf ? { asOf } : {});
    if (!incident) return c.json({ error: "no such replay bundle" }, 404);
    const result = await incidents.process(incident, { notify: false });
    return c.json({
      ok: true,
      incidentId: incident.id,
      ranked: result.ranking?.ranked.length ?? 0,
      confirmation: incident.confirmation,
    });
  });

  app.post("/api/watch/tick", async (c) => {
    if (!watcher) return c.json({ error: "DeepFire is not configured" }, 400);
    return c.json(await watcher.tick());
  });

  // ---------------------------------------------------------------------------
  // Live updates
  // ---------------------------------------------------------------------------

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const wanted = c.req.query("incident");
      let open = true;

      const unsubscribe = bus.subscribe((event) => {
        if (!open) return;
        if (wanted && "incidentId" in event && event.incidentId !== wanted) return;
        void stream
          .writeSSE({ event: event.type, data: JSON.stringify(event) })
          .catch(() => {
            open = false;
          });
      });

      await stream.writeSSE({ event: "ready", data: JSON.stringify({ at: new Date().toISOString() }) });

      // Proxies and load balancers close a stream that goes quiet, and an
      // incident can legitimately be quiet for minutes.
      while (open) {
        await stream.sleep(20_000);
        if (!open) break;
        try {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ at: new Date().toISOString() }),
          });
        } catch {
          open = false;
        }
      }
      unsubscribe();
    }),
  );

  // ---------------------------------------------------------------------------
  // Telegram webhook
  // ---------------------------------------------------------------------------

  app.post("/api/telegram/webhook", async (c) => {
    if (!telegram) return c.json({ ok: true });
    if (env.telegram.webhookSecret) {
      const provided = c.req.header("x-telegram-bot-api-secret-token") ?? "";
      if (!timingSafeEqual(provided, env.telegram.webhookSecret)) {
        return c.json({ ok: false }, 401);
      }
    }
    const update = await c.req.json().catch(() => null);
    if (update) {
      // Telegram retries anything it does not get a prompt 200 for, and an
      // agent turn takes seconds. Acknowledge first, work after.
      void telegram.handleUpdate(update);
    }
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((error, c) => {
    ctx.log.error("Unhandled request error", { error: describeError(error), path: c.req.path });
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

/** Constant-time compare so a token cannot be guessed a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
