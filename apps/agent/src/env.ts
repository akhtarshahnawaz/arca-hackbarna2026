/**
 * Configuration, validated once at boot.
 *
 * Every integration is optional and the system degrades to whatever is
 * configured: no DeepFire credentials means replay-only, no Talaia means
 * detection-only, no SLNG means the approval flow runs but no call is placed.
 * That is deliberate — a missing key should narrow what ARCA can do, never stop
 * it from starting, because the moment you least want a boot failure is the
 * moment you are configuring it under pressure.
 *
 * The exception is the safety rails. `CALL_ALLOWLIST` defaults to empty, which
 * means no outbound calls at all, and `EXERCISE_MODE` defaults to true. Both
 * fail safe: you have to opt in to ARCA phoning a real person.
 */

function str(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function bool(name: string, fallback: boolean): boolean {
  const raw = str(name);
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function num(name: string, fallback: number): number {
  const raw = Number(str(name));
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function list(name: string): string[] {
  return str(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const port = num("PORT", 4000);

export const env = {
  nodeEnv: str("NODE_ENV", "development"),
  port,
  logLevel: str("LOG_LEVEL", "info"),
  publicUrl: str("AGENT_PUBLIC_URL", `http://localhost:${port}`),
  opsToken: str("OPS_TOKEN"),

  deepfire: {
    clientId: str("DEEPFIRE_CLIENT_ID"),
    clientSecret: str("DEEPFIRE_CLIENT_SECRET"),
    baseUrl: str("DEEPFIRE_BASE_URL", "https://api.deepfire.co"),
  },

  talaia: {
    url: str("TALAIA_URL", "https://talaia.up.railway.app"),
    apiKey: str("TALAIA_API_KEY"),
  },

  nebius: {
    apiKey: str("NEBIUS_API_KEY"),
    baseUrl: str("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1"),
    model: str("NEBIUS_MODEL", "openai/gpt-oss-120b"),
    fastModel: str("NEBIUS_FAST_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
  },

  slng: {
    apiKey: str("SLNG_API_KEY"),
    agentsUrl: str("SLNG_AGENTS_URL", "https://api.agents.slng.ai"),
    mediaUrl: str("SLNG_MEDIA_URL", "https://eu-west.api.slng.ai"),
    agentId: str("SLNG_AGENT_ID"),
    // eu-west, not eu-central: no SLNG model is served in eu-central, so an
    // agent created there is refused at the voice-selection step.
    region: str("SLNG_REGION", "eu-west"),
  },

  telegram: {
    botToken: str("TELEGRAM_BOT_TOKEN"),
    botUsername: str("TELEGRAM_BOT_USERNAME"),
    webhookSecret: str("TELEGRAM_WEBHOOK_SECRET_TOKEN"),
    coordinatorChatIds: list("COORDINATOR_TELEGRAM_CHAT_IDS"),
  },

  safety: {
    /** Empty means ARCA places no outbound calls at all. */
    callAllowlist: list("CALL_ALLOWLIST"),
    exerciseMode: bool("EXERCISE_MODE", true),
  },

  watch: {
    bbox: str("AOI_BBOX", "0.15,40.50,3.35,42.90"),
    intervalMinutes: num("WATCH_INTERVAL_MINUTES", 5),
    /**
     * How far back a cluster counts as active.
     *
     * Drives the cluster feed the operations screen browses, so it is a
     * legibility setting as much as a detection one: too short and a fire that
     * has not been overflown for a few hours vanishes from the list while it is
     * still burning.
     */
    clusterLookbackHours: num("CLUSTER_LOOKBACK_HOURS", 24),
    /**
     * Reverse-geocode cluster positions into place names.
     *
     * On by default because "near Solsona" is a name someone can act on and a
     * UUID is not. Set PLACE_LOOKUP=false for a deployment that would rather
     * not send coordinates to a third party; clusters are then labelled with
     * their coordinates instead.
     */
    placeLookup: bool("PLACE_LOOKUP", true),
    horizonHours: num("SPREAD_HORIZON_HOURS", 6),
    ensembleMembers: num("SPREAD_ENSEMBLE_MEMBERS", 10),
    lookbackHours: num("SPREAD_LOOKBACK_HOURS", 12),
  },

  databaseUrl: str("DATABASE_URL"),
} as const;

export type Env = typeof env;

export interface CapabilityReport {
  deepfire: boolean;
  talaia: boolean;
  nebius: boolean;
  slng: boolean;
  telegram: boolean;
  outboundCalls: boolean;
  database: boolean;
  exerciseMode: boolean;
}

/** What this deployment can actually do. Surfaced on /health and in the UI. */
export function capabilities(): CapabilityReport {
  return {
    deepfire: Boolean(env.deepfire.clientId && env.deepfire.clientSecret),
    talaia: Boolean(env.talaia.apiKey),
    nebius: Boolean(env.nebius.apiKey),
    slng: Boolean(env.slng.apiKey && env.slng.agentId),
    telegram: Boolean(env.telegram.botToken && env.telegram.coordinatorChatIds.length > 0),
    outboundCalls: Boolean(
      env.slng.apiKey && env.slng.agentId && env.safety.callAllowlist.length > 0,
    ),
    database: Boolean(env.databaseUrl),
    exerciseMode: env.safety.exerciseMode,
  };
}

/** Warnings worth printing at boot, in the order someone would fix them. */
export function configWarnings(): string[] {
  const caps = capabilities();
  const warnings: string[] = [];
  if (!caps.deepfire) {
    warnings.push("DEEPFIRE_CLIENT_ID/SECRET unset. Live detection is off; replay still works.");
  }
  if (!caps.talaia) {
    warnings.push("TALAIA_API_KEY unset. Incidents open detection-only, with no exposure or ranking.");
  }
  if (!caps.nebius) {
    warnings.push("NEBIUS_API_KEY unset. Briefings use the deterministic template and transcripts are not extracted.");
  }
  if (!caps.slng) {
    warnings.push("SLNG not configured. Approvals are recorded but no call is placed.");
  }
  if (!caps.telegram) {
    warnings.push("Telegram not configured. No proactive briefing; the web UI is unaffected.");
  }
  if (caps.slng && !caps.outboundCalls) {
    warnings.push("CALL_ALLOWLIST is empty. Every approved call opens a browser voice session instead of dialling.");
  }
  if (!caps.database) {
    warnings.push("DATABASE_URL unset. Running in memory; state is lost on restart.");
  }
  if (env.safety.exerciseMode) {
    warnings.push("EXERCISE_MODE is on. Every message and call is prefixed SIMULACRO.");
  }
  if (!env.opsToken) {
    warnings.push("OPS_TOKEN unset. The web API is open to anyone who can reach it.");
  }
  return warnings;
}
