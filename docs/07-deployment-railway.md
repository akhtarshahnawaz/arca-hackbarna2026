# Deploying to Railway

Three services in one Railway project: `arca-agent`, `arca-web`, and Postgres.
Roughly 20 minutes from an empty project to a coordinator receiving a briefing
on their phone.

Everything below also works on Fly, Render or a plain VPS — only the dashboard
steps differ.

## 0. Before you start

- A Railway account and the CLI: `npm i -g @railway/cli && railway login`
- This repository pushed to GitHub
- Credentials from [docs/06-configuration.md](./06-configuration.md). None are
  strictly required: ARCA boots without them and tells you what it cannot do.

## 1. Create the project and database

```bash
railway init --name arca
railway add --database postgres
```

No PostGIS image is needed. ARCA never asks the database a spatial question —
see [docs/01-architecture.md](./01-architecture.md).

## 2. The agent service

In the Railway dashboard: **New → GitHub Repo → this repository**, then name the
service `arca-agent` and set:

| Setting | Value |
|---|---|
| Root directory | `/` (the monorepo root — pnpm workspaces need it) |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @arca/agent build` |
| Start command | `pnpm --filter @arca/agent start` |
| Watch paths | `apps/agent/**`, `packages/**` |

### Variables

Paste into the Raw Editor, filling in your own values:

```bash
NODE_ENV=production
PORT=4000
LOG_LEVEL=info

DATABASE_URL=${{Postgres.DATABASE_URL}}

DEEPFIRE_CLIENT_ID=
DEEPFIRE_CLIENT_SECRET=

TALAIA_URL=https://talaia.up.railway.app
TALAIA_API_KEY=

NEBIUS_API_KEY=
NEBIUS_MODEL=openai/gpt-oss-120b

SLNG_API_KEY=
SLNG_AGENT_ID=

TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET_TOKEN=
COORDINATOR_TELEGRAM_CHAT_IDS=

# Safety rails. Leave CALL_ALLOWLIST empty until you mean it.
CALL_ALLOWLIST=
EXERCISE_MODE=true

AOI_BBOX=0.15,40.50,3.35,42.90
WATCH_INTERVAL_MINUTES=5

OPS_TOKEN=
```

`${{Postgres.DATABASE_URL}}` is a Railway reference — it resolves at deploy time
and follows the database if it is ever recreated.

Generate `OPS_TOKEN` and `TELEGRAM_WEBHOOK_SECRET_TOKEN` with
`openssl rand -hex 24`.

### Domain, then the self-reference

Settings → Networking → **Generate Domain**. Then add one more variable:

```bash
AGENT_PUBLIC_URL=https://arca-agent-production.up.railway.app
```

This matters: an `https://` non-localhost value is what switches Telegram from
long-polling to webhook mode, and polling does not survive a platform that
sleeps idle containers.

### Create the schema

```bash
railway run --service arca-agent pnpm --filter @arca/db push
```

## 3. The web service

**New → GitHub Repo → same repository**, named `arca-web`:

| Setting | Value |
|---|---|
| Root directory | `/` |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @arca/web build` |
| Start command | `pnpm --filter @arca/web start` |
| Watch paths | `apps/web/**`, `packages/core/**` |

```bash
NODE_ENV=production
NEXT_PUBLIC_AGENT_URL=https://arca-agent-production.up.railway.app
```

`NEXT_PUBLIC_*` values are **baked in at build time**. Changing this requires a
redeploy, not a restart.

Generate a domain for this service too.

## 4. Verify

```bash
curl -s https://arca-agent-production.up.railway.app/api/health | jq
```

`capabilities` should reflect what you configured. Anything false there is a
missing variable, and the deploy logs list each one with what it costs.

Then open the web domain. With no live fire — the normal state — you get the
incident picker and the replay bundle.

## 5. Telegram

The bot registers its own webhook at boot once `AGENT_PUBLIC_URL` is public.
Confirm:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq
```

Message the bot from the coordinator's phone. It replies with that chat's id.
Put the id in `COORDINATOR_TELEGRAM_CHAT_IDS` and redeploy.

Then message it from a phone that has never touched it. It should explain what
ARCA is and show nothing about any incident. If it shows you a ranked list, the
allow-list is not set.

## 6. Turning on outbound calls

Only after everything above works.

```bash
pnpm --filter @arca/agent slng:create-agent   # once; prints SLNG_AGENT_ID
```

Set `SLNG_AGENT_ID`, then add **your own** number to `CALL_ALLOWLIST` in E.164:

```bash
CALL_ALLOWLIST=+34600000000
```

Leave `EXERCISE_MODE=true` so every call opens by saying it is a drill.

With an empty allowlist every approval still works and opens a browser voice
session instead — the whole workflow, without dialling anyone.

## Operating notes

**Cost.** The agent polls DeepFire every 5 minutes and must stay warm; do not
put it to sleep or the watcher stops. The web service can sleep freely.

**Scaling.** One agent instance. The event bus is in-process and the watcher
assumes a single watermark holder; two instances would double-submit
simulations against DeepFire's two-in-flight budget. Multi-instance needs a
shared pub/sub behind `bus.ts`, whose surface is two methods for that reason.

**Logs.** One JSON line per event with `incidentId` on everything, so a whole
fire comes out of the log with one grep.

**Backups.** Railway snapshots Postgres. Losing it costs incident history, not
the ability to run: ARCA rebuilds live incidents from DeepFire on the next tick.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `/api/health` 503 | DeepFire configured but unreachable. Check credentials, then `DEEPFIRE_BASE_URL` |
| No incidents, ever | Normal. ARCA opens one only above a 60/100 confirmation score. `POST /api/watch/tick` to force a pass |
| Web shows "Could not load" | `NEXT_PUBLIC_AGENT_URL` wrong or stale. It is baked at build time — redeploy |
| Telegram silent | `getWebhookInfo` shows the registered URL and last error. Usually `AGENT_PUBLIC_URL` is still localhost |
| Approvals recorded, no call | Expected with an empty `CALL_ALLOWLIST`. The timeline says so, and a web session opens instead |
| Exposure "summary only" | Talaia degraded. The ladder is in [docs/01-architecture.md](./01-architecture.md); the incident stays open |
| Map with no fire | `spread.synthetic` true — no usable model output, footprint is drawn rings. The legend says so |
