# ARCA — teammate briefing

HackBarna AI Summit 2026, Norrsken House Barcelona. Read this in about five minutes, then `README.md` to run it.

## What it is

ARCA is a wildfire coordinator tool. Deepfire says where the fire may go. ARCA ranks who needs help first by `spare_time = t_arrival − t_evac`. The formula ranks. The LLM explains. A human Approves any outbound contact.

People stay for the dog and the sheep. Emergency teams already have fire data. Nobody hands them the list: who is inside the ensemble shape, how long each site needs, who is already late. Ensemble language only — “in 7 of 10 runs”, not a flat three hours.

## Hackathon

- Event: HackBarna AI Summit 2026 · Norrsken House Barcelona · 19–20 Sept 2026
- Track: Norrsken “AI for Wildfire” → Values at risk
- Challenges already in play: **Norrsken / Deepfire**, **Mastra**, **Nebius**. Product stack also includes **Vonage Voice** and **SLNG**. Sunday: **Galtea** and **Norma**. No video prize chase.
- Spoken pitch: `PITCH.md`. Build plan: `ARCA-PLAN.md`. Saturday connection notes: `ARCA-GAPS.md` (auditor snapshot — treat as dated).

## Architecture

Two local processes. They do not replace each other.

| Process | Command | Port | Job |
|---|---|---|---|
| Next.js 16 coordinator UI | `npm run dev` | `:3000` | Map, ranked list, Approve / Call, confirmations |
| Mastra agent runtime | `nvm use 22 && npm run mastra:dev` | `:4111` | Studio, agent HTTP APIs, Telegram polling |

Ranking is **plain TypeScript** (`lib/ranking.ts`). Same input → same output. Unit tests in `lib/ranking.test.ts`. The model never reorders the list.

Storage is two LibSQL files:

- `arca.db` (`DATABASE_URL`) — coordinators, residents, reported counts, alert requests, simulation ids, voice-call rows
- `mastra.db` — Mastra memory / Telegram installations. Observability uses DuckDB. Mastra Platform only if `MASTRA_PLATFORM_ACCESS_TOKEN` is set.

`weatherAgent` and `weatherWorkflow` are loaded from `mastra/index.ts`. They are Mastra scaffold, not the product.

## Who uses it

- **Primary:** municipal / civil protection coordinator. Console at `:3000`. Telegram `/briefing` if Mastra is running.
- **Secondary:** residents in wildland areas. They opt in on Telegram (address, animals, transport). They get a fire-window + pet-shelter message only after coordinator Approve.

No real names or phones in seed data. Site codes and animal counts only.

## Data sources

| Source | What the demo actually uses |
|---|---|
| Deepfire | Live Catalonia **hotspots** if `DEEPFIRE_*` works. Hour rings on the map are a labelled **DEMO ensemble**, not a live spread perimeter. |
| Livestock registry | Public SODA `7bpt-5azk`. Extra Bages farms when the pull succeeds. Capacity ≠ animals present. |
| OSM | Care-home **seed** on the list. Not a live Overpass query. Not the pet-evac list. |
| Pet shelters | `config/shelters.json` — coordinator-configured. Not live OSM protectoras. |
| Residents | Telegram opt-in → `arca.db`. Demo household codes are not messaged. |

## Contact policy

Single source: `config/contact-policy.json`. Console chip: **Contact policy: human approval required.**

- `alert-residents` and `call-site` use `requireApproval: true`.
- One Approve covers the Voice retry plan (max 3).
- If Approve does not arrive in 30 minutes, escalate the coordinator. Do not blast residents.
- Auto-veto window in the same file is `enabled: false` — next step, not this demo.

## How to run

```bash
cp .env.example .env.local
# fill privately — never commit .env.local
npm install
npm test
npm run dev                          # coordinator UI :3000
nvm use 22 && npm run mastra:dev     # agent + Studio + Telegram :4111
```

- `:3000` alone is enough to look at the console.
- `:4111` is required to chat with ARCA in Studio or receive Telegram `/briefing` locally. Local Telegram is **polling**. No ngrok for that path.
- `npm run mastra:studio` is UI only; it expects a backend already running.
- Pings: `npm run nebius:ping`, `npm run telegram:ping` (username, never the token).

Full Mastra notes: `README.md` → **mastra:dev**.

## Env vars (names only)

Copy from `.env.example`. Do not put values in git.

**Useful local demo**

- `DEEPFIRE_CLIENT_ID`, `DEEPFIRE_CLIENT_SECRET`, `DEEPFIRE_API_BASE_URL`
- `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, `NEBIUS_MODEL`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`
- `COORDINATOR_TELEGRAM_CHAT_ID`, `TELEGRAM_BACKUP_CHAT_ID`
- `DEMO_CLUSTER_ID` — Catalan wildfire cluster, not Tarragona industry
- `DATABASE_URL`

**Voice (optional; UI still shows Call)**

- `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `VONAGE_APPLICATION_ID`, `VONAGE_PRIVATE_KEY_PATH`, `VONAGE_FROM_NUMBER`, `VONAGE_VOICE_WEBHOOK_URL`
- `SLNG_API_KEY`

Vonage cannot hit localhost. `VONAGE_VOICE_WEBHOOK_URL` needs ngrok or a deploy.

**Leave blank unless you already have them**

- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — Sunday uptime if local disk will be wiped
- `MASTRA_PLATFORM_ACCESS_TOKEN` — hosted Mastra traces
- `GALTEA_API_KEY` — Sunday CLI
- `TELEGRAM_WEBHOOK_SECRET_TOKEN` — only if you later switch Telegram to webhook
- `OPENAI_API_KEY` — unused; agents go through Nebius Token Factory
- `GOOGLE_CLOUD_PROJECT` — unused placeholder
- Public dataset URLs (`CATALUNYA_FARMS_*`, `PYRO_SDIS_*`, `HF_SMOKE_DATASET`, `MTG_DATA_DIRECTORY`) — documentation, not secrets. Pyro-SDIS is a training-image set, not live cameras.

## Built vs stubbed vs Sunday

**Built**

- Coordinator console (`app/page.tsx` → `CommandConsole`): map, ranked + watch lists, freshness strip, Approve / Call / log outcome
- Ranking engine + tests
- Deepfire hotspot client; registry loader (Bages slice)
- Mastra `arca-agent` + ARCA tools; Telegram long-poll if token set
- Nebius explainer / last-corrected count parse (“doscientas… no, trescientas” → 300)
- LibSQL persistence; contact-policy and shelter config
- Escalation nudge to coordinator / backup chat ids

**Stubbed or labelled demo**

- Hour polygons: DEMO ensemble, not live Deepfire spread
- OSM: seed care homes, not Overpass
- Vonage Voice: live only with keys **and** a public webhook. Otherwise Call/Approve stay visible and the routes stub
- SLNG TTS/STT: adapters exist; missing `SLNG_API_KEY` → mock + latency log
- Auto-veto: `enabled: false`
- `weatherAgent` / `weatherWorkflow`: leftover scaffold

**Sunday (do not fake)**

- **Galtea** — Python CLI, account / `gsk_*` key. Attack the agent, fix one failure, re-run, complete the survey.
- **Norma** (Quality Clouds) — MCP + portal Full Scan. Fix one finding, rescan.

`ARCA-PLAN.md` also describes a 15-minute fire-alert schedule. That workflow is **not** wired in `mastra/index.ts`.

## Docs

- `README.md` — run, env, architecture, Galtea / Norma
- `PITCH.md` — 60-second + six beats
- `ARCA-PLAN.md` — rules, ranking, tools, phases
- `TEAM-SUMMARY.md` — this file
- `ARCA-GAPS.md` — Saturday auditor notes; not the current runbook
