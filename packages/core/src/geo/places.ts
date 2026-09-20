import type { Position } from "./index.js";

/**
 * Turning a coordinate into a place name.
 *
 * DeepFire's cluster record has no name in it, and "cluster
 * 11a6ee21-9953-4f35-bf46-a6d3c12f8559" is not something a coordinator can pick
 * off a list under pressure. "near Solsona" is.
 *
 * Nominatim is the right tool for the job and a service run on donated
 * hardware, so three rules are non-negotiable and all three are enforced here
 * rather than left to callers: identify yourself, never exceed one request a
 * second, and cache aggressively. A fire cluster's position moves by metres
 * over hours, so a cache keyed to roughly a hundred metres answers nearly every
 * repeat lookup for free.
 *
 * A name is a nicety. Every failure path returns null and the caller falls back
 * to coordinates — no lookup is ever allowed to delay or fail a survey.
 */

export interface PlaceLookupOptions {
  /**
   * Turn lookups off entirely.
   *
   * Two callers want this: a deployment that would rather not send coordinates
   * to a third party, and every test — a unit test that reaches Nominatim is
   * slow, flaky, and rude to a service run on donated hardware.
   */
  enabled?: boolean;
  /** Sent as User-Agent. Nominatim blocks unidentified clients, correctly. */
  userAgent?: string;
  baseUrl?: string;
  /** Per-request budget. Kept short: a name is never worth a slow screen. */
  timeoutMs?: number;
  /** How long a resolved name is trusted. Place names do not move. */
  ttlMs?: number;
}

interface CacheEntry {
  name: string | null;
  at: number;
}

const DEFAULT_BASE_URL = "https://nominatim.openstreetmap.org";
const MIN_INTERVAL_MS = 1_100;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60_000;

/** ~100 m at Catalan latitudes: one cell per cluster, not one per detection. */
function cacheKey(position: Position): string {
  return `${position[1].toFixed(3)},${position[0].toFixed(3)}`;
}

interface NominatimReverse {
  name?: string;
  address?: Record<string, string>;
  display_name?: string;
}

/**
 * Pick the name a person would use.
 *
 * Preference order is deliberate: a village, then the municipality, then the
 * comarca, then the province. A coordinator in Catalonia thinks in
 * municipalities, so `city_district` and postcode-level detail are skipped
 * entirely — they make the label longer without making it more useful.
 */
function nameFrom(payload: NominatimReverse): string | null {
  const address = payload.address ?? {};
  const candidates = [
    address.village,
    address.town,
    address.hamlet,
    address.city,
    address.municipality,
    payload.name,
    address.county,
    address.state_district,
    address.province,
    address.state,
  ];
  const picked = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return picked ? picked.trim() : null;
}

export class PlaceResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private readonly enabled: boolean;
  /** Serialises every lookup, which is how the one-per-second rule is kept. */
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: PlaceLookupOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.userAgent = options.userAgent ?? "ARCA wildfire operations (https://github.com/highultimate/arca_spain)";
    this.timeoutMs = options.timeoutMs ?? 4_000;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.enabled = options.enabled ?? true;
  }

  /** A cached name, or null. Never makes a request; never waits. */
  cached(position: Position): string | null {
    const entry = this.cache.get(cacheKey(position));
    if (!entry || Date.now() - entry.at > this.ttlMs) return null;
    return entry.name;
  }

  /**
   * Resolve a name, using the cache and the rate-limit queue.
   *
   * Returns null rather than throwing on every failure — network, timeout,
   * rate limit, unparseable body. The caller's fallback is coordinates, which
   * are always correct if less friendly.
   */
  async resolve(position: Position): Promise<string | null> {
    if (!this.enabled) return null;
    const key = cacheKey(position);
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.at < this.ttlMs) return entry.name;

    const run = this.queue.then(async () => {
      // Re-check: several callers can queue behind one in-flight lookup for the
      // same cell, and the first of them fills the cache for the rest.
      const fresh = this.cache.get(key);
      if (fresh && Date.now() - fresh.at < this.ttlMs) return fresh.name;

      const wait = MIN_INTERVAL_MS - (Date.now() - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();

      const name = await this.fetchName(position);
      this.cache.set(key, { name, at: Date.now() });
      return name;
    });

    // The queue must survive a rejected link, or one failure stops every later
    // lookup in the process for good.
    this.queue = run.catch(() => undefined);
    return run.catch(() => null);
  }

  /**
   * Resolve many at once, within a budget.
   *
   * Used by the cluster survey, where a dozen names are wanted but none of them
   * is worth making the operator wait. Whatever resolves inside the budget is
   * returned; the rest come back null and are picked up by the next poll, by
   * which time the cache has them.
   */
  async resolveMany(
    positions: Position[],
    options: { budgetMs?: number } = {},
  ): Promise<Array<string | null>> {
    if (!this.enabled) return positions.map(() => null);
    const budgetMs = options.budgetMs ?? 3_000;
    const deadline = Date.now() + budgetMs;
    const names: Array<string | null> = [];

    for (const position of positions) {
      const cached = this.cached(position);
      if (cached !== null) {
        names.push(cached);
        continue;
      }
      if (Date.now() >= deadline) {
        // Out of budget: warm the cache in the background so the next poll is
        // instant, and return null for now.
        void this.resolve(position);
        names.push(null);
        continue;
      }
      names.push(await this.resolve(position));
    }

    return names;
  }

  private async fetchName(position: Position): Promise<string | null> {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(position[1]),
      lon: String(position[0]),
      // Settlement level. Zooming in further returns street names, which are
      // worse than useless for a fire in open country.
      zoom: "12",
      addressdetails: "1",
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/reverse?${params}`, {
        headers: { "user-agent": this.userAgent, accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return nameFrom((await response.json()) as NominatimReverse);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Coordinates, formatted the way a chart plotter would read them aloud. */
export function describePosition(position: Position): string {
  const [lon, lat] = position;
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
}
