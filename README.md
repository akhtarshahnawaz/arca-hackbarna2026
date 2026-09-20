# ARCA

**DeepFire says where a wildfire may go. Talaia says what is there. ARCA says
who to call first, calls them once a coordinator approves, and re-ranks on what
they say.**

Built for the Norrsken *AI for Wildfire* challenge at HackBarna AI Summit 26,
values-at-risk track.

---

## Testing this app

### 1. Get it running

```bash
git clone https://github.com/highultimate/arca_spain.git
cd arca_spain && git checkout arca-v2

./start.sh --replay
```

That is the whole setup. The script installs dependencies if they are missing,
builds the shared libraries, starts both services, waits for each to answer,
loads the demo incident and opens the operations screen.

**No credentials are needed.** With an empty `.env` you still get the complete
pipeline: detection cleaning, confirmation scoring, ensemble arrival bands,
exposure, ranking, the timeline and the map.

```
./start.sh              start the agent and the web app
./start.sh --replay     also load the demo incident, so the map has a fire in it
./start.sh --check      run the tests and typecheck, then exit
./start.sh --build      run the production build and serve that instead
./start.sh --stop       stop anything it left running
```

Ctrl+C stops both services. Logs are written to `.run/agent.log` and
`.run/web.log`.

Before it hands you the URLs the script prints what this particular deployment
can actually do, read from the live health endpoint rather than guessed from
the file:

```
==> What this deployment can do
     · Live detection (DeepFire)  (not configured)
     · Exposure inventory (Talaia)  (not configured)
     · Briefings and extraction (Nebius)  (not configured)
     · Voice calls (SLNG)  (not configured)
     · Coordinator phone (Telegram)  (not configured)
     · Dialling real numbers  (not configured)
     · Durable storage  (not configured)
     ⚠ Exercise mode is ON. Every message and call says SIMULACRO.
     storage: memory
```

### 2. What to look at

Open <http://localhost:3000>. The screen is three columns: what is burning, where
this one is going, who to call about it. The switch at the top centre says which
world you are looking at, and it is the only control that changes where the data
comes from.

**In Live mode**, the left rail lists every active cluster DeepFire reports
inside the area of interest — including the ones ARCA rejected, with the reason.
On a typical day that is the whole list:

> **la Pobla de Mafumet** · 0 of 151 det · 2 sat · 19:08Z
> All 151 dropped: known heat source.

That is the Tarragona petrochemical complex. Showing it, greyed and explained,
is the point: a system that silently discards nine tenths of its input gives you
no way to judge whether it is discarding the right things.

Click any cluster to work it, even one below the confirmation bar. ARCA opens
the incident, runs the pipeline, and records on the timeline that a human asked.

**Switch to Synthetic** for three generated scenarios that need no live fire,
then, in order:

1. **Hover the confirmation score** in the header. It shows the arithmetic that
   opened the incident: two satellites agreeing, detections persisting 61
   minutes, a 270 MW peak — and two detections masked as a known quarry.
2. **Press play** under the map. The fire grows hour by hour and the impact
   figures beside the scrubber recount with it, from 439 people exposed in the
   first two hours to 1,247 across all six.
3. **Read the card at the top right.** The care home is first, not the 312-pupil
   school. Sixty-four residents need 3.6 hours to move against 60 minutes of
   warning, which makes spare time negative and the recommendation
   shelter-in-place rather than evacuate.
4. **Click a row** under "At risk". It expands to show the assumptions behind the
   estimate, which registries each figure came from, and the state of any call
   ARCA has placed to it.
5. **Toggle "Masked detections"** in the legend and hover a hollow circle. It
   names the quarry it was excluded for. Nothing is deleted; everything
   excluded keeps its reason.

### 3. Check that it degrades honestly

This is the part most worth poking at, because the failure that matters is a
system that quietly pretends.

```bash
# Approve a call with no SLNG key and an empty allowlist
ID=$(curl -s localhost:4000/api/incidents | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).incidents[0].id')
curl -s -X POST localhost:4000/api/incidents/$ID/decisions \
  -H 'content-type: application/json' \
  -d '{"kind":"approve_call","assetId":"demo-care-1","actor":"you"}'
```

Returns `"No call was placed. SLNG is not configured"` with a call status of
`failed`. It never reports a success that did not happen.

```bash
# Paste a transcript with no Nebius key
curl -s -X POST localhost:4000/api/incidents/$ID/transcript \
  -H 'content-type: application/json' \
  -d '{"assetId":"demo-care-1","transcript":"Somos treinta y ocho residentes."}'
```

Returns `"The ranking is unchanged"` and `reranked: false`, rather than guessing
an occupancy figure.

Two more: message the Telegram bot from a phone that is not on the coordinator
list and it explains what ARCA is while showing nothing about any incident.
Block the basemap and the fire and the assets still render on a flat ground.

### 4. Add credentials

Open `.env`. The script creates it from `.env.example` on first run, and it is
gitignored so your filled copy never reaches git. Every key is there with a note
on what leaving it blank costs you. Fill in what you have; the rest can stay
empty. Restart with `./start.sh --replay` and the capability list above will
show what changed.

The order that adds the most, soonest:

| Add | And you get |
|---|---|
| `TALAIA_API_KEY` | Real exposure from ~20 Spanish registries instead of the demo fixture |
| `DEEPFIRE_CLIENT_ID` / `_SECRET` | Live detection and real ensemble simulations |
| `NEBIUS_API_KEY` | Generated briefings and transcript extraction |
| `TELEGRAM_BOT_TOKEN` | The proactive briefing on a phone |
| `SLNG_API_KEY` + `SLNG_AGENT_ID` | Voice calls, and speech-to-text for voice notes |

With DeepFire configured, `POST /api/watch/tick` forces a scan instead of
waiting five minutes. Expect no incidents most of the time: ARCA opens one only
above 60 out of 100, which is the point.

Keep `CALL_ALLOWLIST` empty until you mean it. Every approval still works and
opens a browser voice session instead, which exercises the entire workflow
without dialling anyone.

### 5. The test suite

```bash
./start.sh --check     # or: pnpm test && pnpm typecheck
```

122 tests, no network and no database, in about two seconds. They cover the
cleaning rules, the confirmation score, band construction from an ensemble, the
evacuation model, the action table, ranking order, the cluster survey and the
pipeline end to end.
[docs/09-testing-and-demo.md](docs/09-testing-and-demo.md) lists the six real
bugs they caught while being written.

---

## Deploying

Everything on Railway, from the dashboard — no terminal needed. Three services
in one project: `Postgres`, `arca-agent`, `arca-web`. About twenty minutes.

**Full click-by-click walkthrough, with every variable and the three things that
reliably go wrong: [docs/07-deployment-railway.md](docs/07-deployment-railway.md).**

The short version:

| | `arca-agent` | `arca-web` |
|---|---|---|
| Root directory | blank | blank |
| Build | `pnpm install --frozen-lockfile && pnpm --filter @arca/agent build` | `pnpm install --frozen-lockfile && pnpm --filter @arca/web build` |
| Start | `pnpm --filter @arca/agent start` | `pnpm --filter @arca/web start` |
| Pre-deploy | `pnpm --filter @arca/db push:ci` — once, then clear it | none |
| Watch paths | `/apps/agent/**`, `/packages/**` | `/apps/web/**`, `/packages/core/**` |
| Sleeping | **off** | fine |

Both stay rooted at the monorepo root, because this is a pnpm workspace and the
agent's build pulls `@arca/core` and `@arca/db` from the same tree. Leave `PORT`
unset; Railway injects one per service and both bind what they are given.

**The agent has to run somewhere that keeps a process alive.** It polls DeepFire
on a timer, holds an in-process event bus, and streams server-sent events to
open browsers. Serverless functions do none of that — which is why Railway
rather than Vercel for that half, and once the agent is there, keeping the web
app beside it means one platform, one log stream, one bill.

Three things that catch people out, all covered in the guide:

- **Use `push:ci`, not `push`,** for the schema. Plain `drizzle-kit push` asks
  for confirmation, and a pre-deploy container has no terminal to ask.
- **`NEXT_PUBLIC_AGENT_URL` is baked into the bundle at build time.** Changing
  it needs a redeploy, not a restart.
- **`OPS_TOKEN` protects the whole API** and cannot be a public variable, so the
  web app prompts for it once per browser.

<details>
<summary>Putting the web app on Vercel instead</summary>

It works and the build config already handles it — `output: "standalone"` is
dropped when Vercel is detected. Root directory `apps/web`, build command
`pnpm --filter @arca/web build`, and the same `NEXT_PUBLIC_AGENT_URL`. The agent
still has to live somewhere that keeps a process alive.

</details>

### After deploying

1. Open the web domain. With no live fire — the normal state — you get the
   feed of active clusters on the left, every one of them scored, and the
   synthetic scenarios one switch away.
2. Message the Telegram bot from the coordinator's phone. It replies with that
   chat's id. Put the id in `COORDINATOR_TELEGRAM_CHAT_IDS` and redeploy.
3. Message it from a phone that has never touched it. It should explain what
   ARCA is and show nothing about any incident. If it shows you a ranked list,
   the allow-list is not set.
4. Only then consider `CALL_ALLOWLIST`, starting with your own number, and leave
   `EXERCISE_MODE=true` so every call opens by saying it is a drill.

### Operating notes

**Do not sleep the agent.** The watcher stops with it. The web service can sleep
freely.

**One agent instance.** The event bus is in-process and the watcher assumes a
single watermark holder; two instances would double-submit simulations against
DeepFire's two-in-flight budget. Multi-instance needs a shared pub/sub behind
`bus.ts`, whose surface is two methods for exactly that reason.

**Losing Postgres costs history, not function.** ARCA rebuilds live incidents
from DeepFire on the next tick.

[docs/07-deployment-railway.md](docs/07-deployment-railway.md) has the full
walkthrough and a troubleshooting table.

---

## The problem

Spain had a record wildfire year. The data is not the bottleneck: satellites,
weather stations and registries all publish. What a coordinator lacks at two in
the morning is a **ranked list of who runs out of time first**.

A fire model outputs geometry. An incident commander needs an answer: which care
home, which school, how many people, how long have they got.

## What ARCA does

```
DETECT ─► CLEAN ─► CONFIRM ─► SIMULATE ─► EXPOSE ─► RANK ─► BRIEF ─► APPROVE ─► CALL ─► EXTRACT ─► RE-RANK
```

1. **Cleans the detections.** Static heat sources are masked with a buffer that
   scales to each sensor's pixel. Uncorroborated low-confidence pixels and
   same-sensor re-reports are excluded. Nothing is deleted — every excluded
   pixel keeps the reason, on the map, on hover.
2. **Confirms the fire** with an auditable 0–100 score built from named
   components, so the reason it woke someone is legible.
3. **Runs a 10-member ELMFIRE ensemble** through DeepFire and turns the result
   into hourly arrival bands.
4. **Asks Talaia what is inside each band** — schools, care homes, hospitals,
   farms, campsites, hazardous sites — with capacity, contacts and provenance.
5. **Ranks by spare time**: `time until the fire arrives − time needed to empty
   the site`. Not by size, not by value.
6. **Briefs the coordinator unprompted** on Telegram, in six lines.
7. **Calls a site once a human approves**, asks four questions, and re-ranks on
   the answers.

## The one property worth stating plainly

**The language model cannot place a phone call.** Not by instruction — by
construction. There is no code path from it to the voice service that does not
pass through a stored decision naming a human actor. Two rails then sit in front
of the dispatch: a call allowlist that is **empty by default**, and an exercise
mode that is **on by default**.

## What it looks like

One screen, for a wall display and a laptop at once, in three columns: the feed
of active fires, the map, and the decision. The fire is drawn in DeepFire's own
burn-probability ramp; the scrubber plays the six-hour horizon hour by hour, and
the impact figures beside it recount as it moves — 439 people exposed in the
first two hours, 1,247 across all six.

Colour is a language, not decoration: one colour per protective action, used
identically on the map, in the list and in the legend. Warm means the fire, cool
means an instruction about people, and red is the single crossover because
"evacuate now" is the one instruction that is about the fire arriving.

## Running the pieces yourself

`start.sh` is a convenience, not a requirement:

```bash
pnpm install
pnpm dev:agent              # :4000  — pipeline, agent, HTTP API, Telegram
pnpm dev:web                # :3000  — operations screen
pnpm test                   # 122 tests, no network, no database
```

The agent reads `.env` itself through node's `--env-file-if-exists`, so it
picks the file up with no wrapper and no extra dependency.

## Repository

```
packages/core     Every decision, as pure functions. No I/O.
packages/db       Durable state behind one interface; memory and Postgres.
apps/agent        Watcher, pipeline, agent, voice, HTTP API, Telegram bot.
apps/web          The operations screen.
fixtures/replay   Scenario bundles, replayed through the live code path.
docs/             How and why it works.
```

## Documentation

| | |
|---|---|
| [Architecture](docs/01-architecture.md) | Services, the lifecycle, and how every upstream failure degrades |
| [Detection and cleaning](docs/02-data-pipeline.md) | The rules, the confirmation score, and how an ensemble becomes arrival bands |
| [Ranking](docs/03-ranking.md) | Spare time, the evacuation model, the action table |
| [Agent and voice](docs/04-agent-and-voice.md) | Tools, the approval path, the call script, extraction |
| [HTTP API](docs/05-api.md) | Every endpoint |
| [Configuration](docs/06-configuration.md) | Every variable, and what leaving it out costs |
| [Deploying to Railway](docs/07-deployment-railway.md) | Empty project to a briefing on a phone |
| [Extending](docs/08-extending.md) | Regions, rules, sources, tools, stores |
| [Testing and the demo](docs/09-testing-and-demo.md) | Scenarios, the three-minute script, manual checks |
| [Modes and the feed](docs/10-modes-and-the-feed.md) | Live vs synthetic, watch areas, working a cluster, waiting for the model |
| [Reading the map](docs/11-reading-the-map.md) | The probability gradient, detections, site glyphs |

## Design decisions worth knowing

**Ranking is plain code; the model explains it.** Every figure in a briefing is
computed before the model is called, and the model is given them as facts it may
only rephrase. The language is generated. The content is not.

**A partial answer beats an error page.** Every upstream has a degradation path
and every degraded answer says which rung it came from — including on screen.

**Capacity is not occupancy.** Every figure carries its basis: registered,
reported, or unknown. A school's enrolment is not the children present at 3 a.m.

**Nothing is deleted.** A coordinator who sees a bright pixel on another system
and not here must be able to find it, greyed out, with a sentence saying why.
"That is the Tarragona refinery flare" is an answer. A missing dot is not.

**People are never monetised.** Replacement-cost estimates are triage figures,
reported separately and styled as secondary. Facility occupancy and census
population are never summed — they count different people by different methods.

## Limits

- Evacuation times are **stated assumptions, not doctrine**. They are versioned
  in config, served by `GET /api/policy`, quoted in every explanation, and meant
  to be corrected by the people who actually do this.
- Registry capacity is a maximum. It does not know who has already left.
- Satellite perimeters are not surveyed fire boundaries.
- One agent instance. Multi-instance needs a shared bus — see
  [Extending](docs/08-extending.md).
- ARCA informs decisions. It does not make them, and it never issues an
  evacuation order.

## Built with

[DeepFire](https://docs.deepfire.co) · [Talaia](https://talaia.up.railway.app) ·
[Nebius Token Factory](https://tokenfactory.nebius.com) ·
[Mastra](https://mastra.ai) · [SLNG](https://docs.slng.ai) ·
[MapLibre](https://maplibre.org) · [Open-Meteo](https://open-meteo.com) ·
Next.js · Hono · Drizzle

## Licence

MIT. See [LICENSE](LICENSE).
