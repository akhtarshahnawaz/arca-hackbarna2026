# ARCA connections — Saturday 12:35 (auditor)

Workspace `/Users/demianneo/Downloads/hackbarna` was empty. Handoff files live in `/Users/demianneo/Documents/ChatGPT/hackaton` (`ARCA-CONNECTIONS.md`, `.env.example`, `.gitignore`). Copy those in **before** any secrets. Do not commit keys.

## Status

| Resource | Status | Next action |
|---|---|---|
| Deepfire | **READY** (live token 200; not saved here) | Paste `DEEPFIRE_CLIENT_ID` / `DEEPFIRE_CLIENT_SECRET` into ignored `.env.local`. First product sim: Catalunya cluster `5b03169d-8daa-4531-b05b-ba7231973da4`, `ensembleMembers: 10`, `durationHours: 6`. |
| Livestock `7bpt-5azk` | **PUBLIC** | SODA counts only. Parse DMS + `coor_x`/`coor_y`. Do **not** geocode 27k farms. Capacity ≠ headcount. |
| OSM Overpass | **PUBLIC** | Query hospitals / schools / care homes / animal shelters. No key. |
| Nebius | **MISSING KEY** | Booth/console: OpenAI-compatible key + free credits. |
| Telegram | **WIRED** (polling) | Token in ignored `.env.local` as `TELEGRAM_BOT_TOKEN` only. No webhook required for `mastra:dev`. |
| Mastra | **IN REPO** | `nvm use 22 && npm run mastra:dev` → Studio :4111. |
| Vonage Voice | **STUB / LIVE if keys** | Voice only. Call after Approve. Public webhook required. |
| SLNG | **ADAPTER + MOCK** | TTS/STT. Latency logged. Needs `SLNG_API_KEY`. |
| Galtea / Norma | **SUNDAY** | CLI / MCP documented in README. Do not fake a scan today. |
| WeatherNext / local ELMFIRE / MTG raw / Pyro-SDIS | **SKIP** | Pyro-SDIS is a public HF **training image** set, not live cameras. |

## Registry completeness (`7bpt-5azk`, queried 2026-09-19)

- **27,001** rows / **20,321** distinct `codi_rega` (one row per species, not per farm).
- All rows `estat_explotaci_ = Activa`. Catalog last row update **2026-08-03** (~6 weeks stale).
- Lat/lon present: **26,216** rows (19,636 farms). Missing lat/lon: **785** rows (685 farms).
- Of those 785: **775** still have `coor_x`/`coor_y`. Only **10** rows have no coordinates at all.
- `latitud`/`longitud` are **DMS text** (`42.0º 8.0' 33.0498''`), not decimal degrees. Parse them. Geocoding is not the default.
- `cap_n_m_total_animals > 0` on only **244** rows. Use species `cap_*` / `total_ub` (25,113 rows > 0) and still label as **registry capacity**, never animals present.

## Deepfire (no secrets)

- Token exchange works. `expires_in` ≈ 180 days. Cache it; no refresh token.
- Collections: `deepfire:clusters`, `deepfire:hotspots`, `deepfire:satellite-perimeters`, `deepfire:static-heat-sources`.
- Active clusters Iberia bbox: **101**. Catalunya bbox: **6**. Hottest CAT cluster: `5b03169d-…` last seen 2026-09-19T10:18Z at ~1.23, 41.18.
- `GET /v1/fire-spread/simulations` works (auto 12h / 1-member runs). Do not burn a 10×6 ensemble until the app can poll it.

## Repo / env / MCP

- Documents `.gitignore` already ignores `.env` / `.env.*` (keeps `.env.example`). Workspace has **no git** — add that ignore **before** `.env.local` and **before** a public Mastra repo.
- No keys exist in either folder. Auditor tested Deepfire in-memory only.
- Cursor MCP: **none required for P0**. Browser + Firebase are connected (Firebase points at an unrelated project). HF / Vercel / Slack = `needsAuth`. Vercel only later for deploy. HF not needed (Pyro-SDIS is a public URL).

## Ranking rule the UI must implement

`spare_time = t_arrival - t_evac`. Call the site with **less** spare time. Probability of reach is the **tie-break**, not the first sort. If `t_evac` is unknown, ask for it — do not rank on 3/10 vs 9/10 alone.
