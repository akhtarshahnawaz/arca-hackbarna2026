# ARCA

**DeepFire says where a wildfire may go. Talaia says what is there. ARCA says
who to call first, calls them once a coordinator approves, and re-ranks on what
they say.**

Built for the Norrsken *AI for Wildfire* challenge at HackBarna AI Summit 26,
values-at-risk track.

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

One screen, for a wall display and a laptop at once. The fire is drawn in
DeepFire's own burn-probability ramp; the scrubber plays the six-hour horizon
hour by hour, and the impact figures recount as it moves — 439 people exposed in
the first two hours, 1,247 across all six.

Colour is a language, not decoration: one colour per protective action, used
identically on the map, in the list and in the legend.

## Quick start

```bash
./start.sh --replay
```

That installs what is missing, starts both services, opens the operations
screen and loads the demo incident. **No credentials are needed** — you get the
full pipeline: cleaning, confirmation scoring, ensemble bands, exposure,
ranking, the timeline and the map.

```
./start.sh              start the agent and the web app
./start.sh --replay     also load the demo incident
./start.sh --check      tests and typecheck, then exit
./start.sh --build      run the production build and serve that
./start.sh --stop       stop anything it left running
```

Ctrl+C stops both. Logs go to `.run/`.

To run the pieces yourself instead:

```bash
pnpm install
cp .env.example .env        # every key is optional; ARCA degrades to what it has

pnpm dev:agent              # :4000  — pipeline, agent, HTTP, Telegram
pnpm dev:web                # :3000  — operations screen
pnpm test                   # 90 tests, no network, no database
```

## What each key adds

Nothing is required. A missing key narrows what ARCA can do and the boot log
says exactly what it costs.

| Key | Adds |
|---|---|
| `DEEPFIRE_CLIENT_ID` / `SECRET` | Live detection and real fire-spread simulations |
| `TALAIA_API_KEY` | Real exposure from ~20 Spanish registries and OpenStreetMap |
| `NEBIUS_API_KEY` | Generated briefings and transcript extraction |
| `SLNG_API_KEY` + `SLNG_AGENT_ID` | Voice calls to sites, speech-to-text for voice notes |
| `TELEGRAM_BOT_TOKEN` | The coordinator's phone |
| `DATABASE_URL` | Durability. Unset runs in memory |

## Repository

```
packages/core     Every decision, as pure functions. No I/O.
packages/db       Durable state behind one interface; memory and Postgres.
apps/agent        Watcher, pipeline, agent, voice, HTTP API, Telegram bot.
apps/web          The operations screen.
fixtures/replay   Recorded incidents, replayed through the live code path.
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
| [Testing and the demo](docs/09-testing-and-demo.md) | Replay, the three-minute script, manual checks |

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
