/**
 * @arca/db — durable state, behind one narrow interface.
 *
 * `createStore` is the only entry point the rest of the system uses, so moving
 * between the in-memory and Postgres implementations is a deployment choice
 * rather than a code change.
 */

export * as schema from "./schema.js";
export { MemoryStore } from "./memory-store.js";
export { PostgresStore } from "./postgres-store.js";
export { maskPhone } from "./store.js";
export type {
  CallRecord,
  DecisionRecord,
  ExposureRecord,
  SiteRecord,
  SpreadRunRecord,
  Store,
} from "./store.js";

import { MemoryStore } from "./memory-store.js";
import { PostgresStore } from "./postgres-store.js";
import type { Store } from "./store.js";

/**
 * Pick a store from the environment.
 *
 * A missing DATABASE_URL is a supported configuration, not an error: ARCA runs
 * end to end in memory, which is what makes a laptop demo and the agent test
 * suite possible. A *broken* DATABASE_URL is different — that is a
 * misconfiguration to surface rather than paper over, so it throws unless the
 * caller explicitly allows the fallback.
 */
export async function createStore(
  options: { url?: string | undefined; fallbackToMemory?: boolean } = {},
): Promise<Store> {
  const url = options.url?.trim();
  if (!url) {
    const store = new MemoryStore();
    await store.init();
    return store;
  }

  const store = new PostgresStore(url);
  try {
    await store.init();
    return store;
  } catch (error) {
    await store.close().catch(() => undefined);
    if (!options.fallbackToMemory) throw error;
    const memory = new MemoryStore();
    await memory.init();
    return memory;
  }
}
