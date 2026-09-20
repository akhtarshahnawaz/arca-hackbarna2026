# Configuration

Copy [`.env.example`](../.env.example) to `.env`. Never commit the filled copy.

## The principle

Every integration is optional and the system degrades to whatever is configured.
No DeepFire credentials means replay-only. No Talaia means detection-only. No
SLNG means the approval flow runs but no call is placed.

A missing key should narrow what ARCA can do, never stop it from starting,
because the moment you least want a boot failure is the moment you are
configuring it under pressure. `configWarnings()` prints exactly what is missing
and what that costs, in the order someone would fix it.

**The safety rails are the exception.** They default to the safe value, so you
have to opt in to ARCA phoning a real person.

## Variables

### DeepFire — detections, clusters, static sources, fire spread

| Variable | Default | Notes |
|---|---|---|
| `DEEPFIRE_CLIENT_ID` | — | app.deepfire.co → Settings → API clients |
| `DEEPFIRE_CLIENT_SECRET` | — | |
| `DEEPFIRE_BASE_URL` | `https://api.deepfire.co` | |

Tokens last 180 days and are cached in the store, because an account is capped
at five API keys and a restart loop could otherwise churn through them.

### Talaia — the exposure inventory

| Variable | Default |
|---|---|
| `TALAIA_URL` | `https://talaia.up.railway.app` |
| `TALAIA_API_KEY` | — |

Use an unlimited-tier key: a six-hour band of a large fire exceeds the free
tier's 250 km² cap. The client splits oversized areas into tiles anyway, but a
tiled answer is a degraded one.

### Nebius — briefings and transcript extraction

| Variable | Default |
|---|---|
| `NEBIUS_API_KEY` | — |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` |
| `NEBIUS_MODEL` | `openai/gpt-oss-120b` |
| `NEBIUS_FAST_MODEL` | `meta-llama/Llama-3.3-70B-Instruct` |

Pick a model that supports tool calling and JSON schema:

```bash
curl -H "Authorization: Bearer $NEBIUS_API_KEY" \
  "https://api.tokenfactory.nebius.com/v1/models?verbose=true" \
  | jq '.data[] | {id, supported_features}'
```

### SLNG — outbound voice and speech to text

| Variable | Default |
|---|---|
| `SLNG_API_KEY` | — |
| `SLNG_AGENT_ID` | — |
| `SLNG_AGENTS_URL` | `https://api.agents.slng.ai` |
| `SLNG_MEDIA_URL` | `https://eu-west.api.slng.ai` |
| `SLNG_REGION` | `eu-central` |

Create the agent once:

```bash
pnpm --filter @arca/agent slng:create-agent
```

### Telegram

| Variable | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/newbot` |
| `TELEGRAM_BOT_USERNAME` | Without the `@` |
| `TELEGRAM_WEBHOOK_SECRET_TOKEN` | `openssl rand -hex 16` |
| `COORDINATOR_TELEGRAM_CHAT_IDS` | Comma-separated numeric chat ids |

Only these chat ids see incident data or can authorise anything. To find yours,
message the bot: it replies with your chat id and nothing else.

Spanish mobile numbers are not chat ids.

### Safety rails

| Variable | Default | Effect |
|---|---|---|
| `CALL_ALLOWLIST` | *empty* | **Empty means ARCA places no outbound calls at all.** Comma-separated E.164 |
| `EXERCISE_MODE` | `true` | Prefixes every message and call with "SIMULACRO / EXERCISE" |

Turn `EXERCISE_MODE` off only when ARCA is genuinely being used on a real
incident by people who know it is on.

### Watching

| Variable | Default | Notes |
|---|---|---|
| `AOI_BBOX` | `0.15,40.50,3.35,42.90` | Catalonia. Spain: `-9.50,35.90,4.40,43.90` |
| `WATCH_INTERVAL_MINUTES` | `5` | |
| `SPREAD_HORIZON_HOURS` | `6` | Matches evacuation timescales |
| `SPREAD_ENSEMBLE_MEMBERS` | `10` | 1–50. Ten makes "7 of 10 runs" readable |
| `SPREAD_LOOKBACK_HOURS` | `12` | Only hotspots this recent seed a simulation |

Always keep the bbox tight. A broad-area query with a large limit and no other
filter is the one shape that reliably exceeds DeepFire's 30-second budget.

### Services

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `AGENT_PUBLIC_URL` | `http://localhost:4000` | An `https://` non-localhost value switches Telegram to webhook mode |
| `OPS_TOKEN` | *empty* | Any non-empty value enables API auth |
| `DATABASE_URL` | *empty* | Unset runs in memory. Set-but-unreachable fails loudly |
| `LOG_LEVEL` | `info` | |
| `NEXT_PUBLIC_AGENT_URL` | `http://localhost:4000` | Web app only, baked in at build time |
| `NEXT_PUBLIC_BASEMAP_URL` | CARTO dark matter | Any MapLibre style URL |

## Tuning the decision rules

The three policy files are the product's opinions, and they are meant to be
argued with:

| File | Governs |
|---|---|
| [`cleaning-policy.json`](../packages/core/src/config/cleaning-policy.json) | Mask buffers, duplicate radius, confirmation scoring |
| [`ranking-policy.json`](../packages/core/src/config/ranking-policy.json) | Probability floor, horizon, action thresholds |
| [`evac-times.json`](../packages/core/src/config/evac-times.json) | Evacuation time per site type and species |

All three are served by `GET /api/policy` and quoted by the agent's
`explain_policy` tool. Change the file, restart, and both the engine and the
explanation move together.
