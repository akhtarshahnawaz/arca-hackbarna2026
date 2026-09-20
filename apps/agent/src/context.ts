import { randomUUID } from "node:crypto";
import { DeepFireClient, TalaiaClient, type TimelineEvent, type TimelineKind } from "@arca/core";
import { createStore, type Store } from "@arca/db";
import { env, capabilities, type CapabilityReport } from "./env.js";
import { bus } from "./bus.js";
import { createLogger, describeError, type Logger } from "./logger.js";

/**
 * The composition root.
 *
 * Everything with an external dependency is constructed once, here, and passed
 * down. No module reaches for a client or a database connection on its own,
 * which is what lets the whole pipeline run in a test against an in-memory
 * store and stub clients without a single mock of a module import.
 */

export interface Context {
  store: Store;
  deepfire: DeepFireClient | null;
  talaia: TalaiaClient | null;
  log: Logger;
  capabilities: CapabilityReport;
  /** Append to an incident's timeline and push it to every open tab. */
  timeline(
    incidentId: string,
    kind: TimelineKind,
    message: string,
    options?: { actor?: string; data?: Record<string, unknown> },
  ): Promise<TimelineEvent>;
}

/**
 * DeepFire tokens live 180 days. Persisting them means a redeploy does not mint
 * a new one, which matters because an account is capped at five API keys and a
 * restart loop could otherwise churn through them.
 */
function tokenStore(store: Store) {
  return {
    async get() {
      return store.getKv<{ value: string; expiresAt: number }>("deepfire:token");
    },
    async set(token: { value: string; expiresAt: number }) {
      await store.setKv("deepfire:token", token);
    },
  };
}

export async function createContext(): Promise<Context> {
  const log = createLogger("ctx");
  const caps = capabilities();

  const store = await createStore({
    url: env.databaseUrl || undefined,
    // A database that is configured but unreachable is a misconfiguration to
    // surface loudly, not to paper over by silently losing durability.
    fallbackToMemory: false,
  });
  log.info(`Store ready (${store.kind}).`);

  const deepfire = caps.deepfire
    ? new DeepFireClient({
        clientId: env.deepfire.clientId,
        clientSecret: env.deepfire.clientSecret,
        baseUrl: env.deepfire.baseUrl,
        tokenStore: tokenStore(store),
        maxConcurrentSimulations: 2,
        onRetry: (attempt, error, waitMs) =>
          log.warn(`DeepFire retry ${attempt} in ${waitMs} ms`, { error: describeError(error) }),
      })
    : null;

  const talaia = caps.talaia
    ? new TalaiaClient({
        baseUrl: env.talaia.url,
        apiKey: env.talaia.apiKey,
        onEvent: (event) => {
          const line = `Talaia ${event.step}: ${event.message}`;
          if (event.level === "error") log.error(line, event.data);
          else if (event.level === "warn") log.warn(line, event.data);
          else log.info(line, event.data);
        },
      })
    : null;

  const context: Context = {
    store,
    deepfire,
    talaia,
    log,
    capabilities: caps,
    async timeline(incidentId, kind, message, options = {}) {
      const event: TimelineEvent = {
        id: randomUUID(),
        incidentId,
        at: new Date().toISOString(),
        kind,
        actor: options.actor ?? "system",
        message,
        data: options.data ?? null,
      };
      // A timeline write must never take an incident down with it. The event is
      // published either way, so the screen stays live even if the store is not.
      await store.addTimelineEvent(event).catch((error) => {
        log.error("Timeline write failed", { error: describeError(error), incidentId });
      });
      bus.publish({ type: "timeline", incidentId, event });
      return event;
    },
  };

  return context;
}
