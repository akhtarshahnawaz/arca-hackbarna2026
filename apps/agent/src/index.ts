import { serve } from "@hono/node-server";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext } from "./context.js";
import { createApp } from "./server/app.js";
import { IncidentService } from "./pipeline/incident.js";
import { ReplayService } from "./pipeline/replay.js";
import { Watcher } from "./pipeline/watcher.js";
import { createCoordinatorAgent } from "./agent/coordinator.js";
import { TelegramBot } from "./telegram/bot.js";
import { env, capabilities, configWarnings } from "./env.js";
import { log, describeError } from "./logger.js";

/**
 * Boot.
 *
 * Order matters in one place: the incident service needs a notifier, and the
 * Telegram bot needs the incident service to act on an approval. The cycle is
 * broken with a late-bound function rather than a circular import, which keeps
 * both modules independently testable.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(process.env.FIXTURES_DIR ?? join(here, "..", "..", "..", "fixtures", "replay"));

async function main(): Promise<void> {
  log.info("ARCA starting", { nodeEnv: env.nodeEnv, port: env.port });
  for (const warning of configWarnings()) log.warn(warning);

  const ctx = await createContext();
  const replay = new ReplayService(ctx, fixturesDir);

  // Talaia's last-resort fallback reads the same recorded bundles the replay
  // engine uses, so a demo survives the exposure API being unreachable.
  if (ctx.talaia) {
    (ctx.talaia as unknown as { options: { fixtureLoader?: (name: string) => Promise<unknown> } }).options.fixtureLoader =
      (name: string) => replay.exposureFor(name);
  }

  let telegram: TelegramBot | null = null;

  const incidents = new IncidentService(
    ctx,
    async (incident, text, ranking) => {
      await telegram?.briefIncident(incident, text, ranking);
    },
    // Replay incidents carry their own exposure, so the pipeline runs end to
    // end with no Talaia key. Live incidents get null and rely on Talaia.
    async (incident) => (incident.replay ? replay.exposureFor(incident.name) : null),
  );

  const agent = createCoordinatorAgent({
    ctx,
    incidents,
    requestApproval: async (input) => {
      if (!telegram?.configured) {
        return `Telegram is not configured, so no approval card could be sent. Approve the call for ${input.siteName} from the operations screen instead.`;
      }
      return telegram.requestApproval(input);
    },
  });

  if (env.telegram.botToken) {
    telegram = new TelegramBot(ctx, incidents, agent);
  }

  const watcher = ctx.deepfire
    ? new Watcher(ctx, async (incident) => {
        await incidents.process(incident);
      })
    : null;

  const app = createApp({ ctx, incidents, replay, watcher, agent, telegram });

  const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
    log.info(`HTTP listening on :${info.port}`);
  });

  // Telegram transport: webhook in production because a platform that sleeps
  // idle containers will not keep a long poll alive; polling locally because it
  // needs no public URL.
  if (telegram?.configured) {
    const isPublic = /^https:\/\//.test(env.publicUrl) && !env.publicUrl.includes("localhost");
    if (isPublic) {
      await telegram.registerWebhook(env.publicUrl);
    } else {
      await telegram.deleteWebhook();
      telegram.startPolling();
    }
  }

  let ticking = false;
  const tick = async (): Promise<void> => {
    if (!watcher || ticking) return;
    ticking = true;
    try {
      await watcher.tick();
    } catch (error) {
      log.error("Watcher tick threw", { error: describeError(error) });
    } finally {
      ticking = false;
    }
  };

  let timer: NodeJS.Timeout | null = null;
  if (watcher) {
    const intervalMs = env.watch.intervalMinutes * 60_000;
    log.info(`Watching ${env.watch.bbox} every ${env.watch.intervalMinutes} min.`);
    // A short delay before the first tick so the HTTP port is already accepting
    // connections when a platform health check arrives.
    setTimeout(() => void tick(), 5_000);
    timer = setInterval(() => void tick(), intervalMs);
  }

  const caps = capabilities();
  log.info("ARCA ready", {
    storage: ctx.store.kind,
    detection: caps.deepfire ? "live" : "replay-only",
    exposure: caps.talaia,
    assistant: caps.nebius,
    voice: caps.outboundCalls ? "calls" : caps.slng ? "web-sessions" : "off",
    exerciseMode: caps.exerciseMode,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`${signal} received, shutting down.`);
    if (timer) clearInterval(timer);
    telegram?.stopPolling();
    server.close();
    await ctx.store.close().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // An unhandled rejection in a background poll must be logged, not fatal: the
  // coordinator's screen should keep working while one call retries itself.
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection", { error: describeError(reason) });
  });
}

main().catch((error) => {
  log.error("ARCA failed to start", { error: describeError(error) });
  process.exit(1);
});
