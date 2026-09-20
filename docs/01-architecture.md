# Architecture

## The shape of the problem

A wildfire system has to answer three questions in order, and each one is a
different kind of problem:

1. **Is this real?** Satellites report thousands of hot pixels a day across
   Iberia. Most are flares, kilns, quarries and sun glint. Getting this wrong in
   one direction floods a coordinator with false alarms until they stop reading
   the alerts; getting it wrong in the other means a real fire goes unreported.
2. **Where is it going?** A physics question, answered by a fire model.
3. **What is in the way, and who do we call first?** A data-integration question
   answered by registries, and a triage question answered by arithmetic.

ARCA owns (1) and (3). DeepFire owns (2). Talaia owns the registry side of (3).
The parts that are not ARCA's are not reimplemented.

## Services

```
                          ┌──────────────────────────────────────────┐
  satellites              │              arca-agent                  │
      │                   │                                          │
      ▼                   │  watcher ── clean ── confirm ── incident │
  DeepFire API ◄──────────┤     │                                    │
   hotspots               │     ├─ spread ──────► DeepFire fire-spread│
   clusters               │     │                                    │
   perimeters             │     ├─ exposure ─────► Talaia /v1/exposure│
   static heat sources    │     │                                    │
   fire spread            │     ├─ rank (pure, @arca/core)           │
                          │     │                                    │
  Open-Meteo ◄────────────┤     ├─ brief ────────► Nebius            │
   wind, humidity         │     │                                    │
                          │     └─ approve ──────► SLNG voice        │
  Talaia ◄────────────────┤                                          │
   exposure inventory     │  HTTP API + SSE          Telegram bot    │
   20 registries + OSM    └───────┬──────────────────────┬───────────┘
                                  │                      │
                          ┌───────▼────────┐      ┌──────▼───────┐
                          │   arca-web     │      │ coordinator  │
                          │ operations UI  │      │    phone     │
                          └────────────────┘      └──────────────┘
                                  │
                          ┌───────▼────────┐
                          │  Postgres      │  (optional: in-memory otherwise)
                          └────────────────┘
```

| Package | What it is | Why it is separate |
|---|---|---|
| `@arca/core` | Every decision, as pure functions. No I/O. | The agent, the HTTP API and the replay runner share one implementation instead of three that drift. It is also what makes the rules testable against recorded fixtures. |
| `@arca/db` | Durable state behind one narrow interface, with in-memory and Postgres implementations. | Lets a laptop demo and the entire agent test suite run with no container, while production gets durability. |
| `apps/agent` | The long-running service: watcher, pipeline, agent, voice, HTTP, Telegram. | Needs a process that is always up and stateful. Serverless functions time out and lose the watcher's watermark. |
| `apps/web` | The operations screen. | Talks only to the agent. Holds no business logic — it renders decisions, it does not make them. |

## Why Postgres is not a spatial database

Every spatial decision — masking, band construction, point-in-polygon, ranking —
happens in `@arca/core` against geometry held in memory for the few minutes an
incident is live, or inside Talaia, which already has an R-tree and a Rust core
built for exactly this. ARCA never asks the database a spatial question.

Adding PostGIS would duplicate that machinery, pin the deployment to a specific
Postgres image, and buy nothing. Geometry is stored as JSONB because it is a
value to hand back, not something to query on.

## The incident lifecycle

```
DETECT ─► CLEAN ─► CONFIRM ─► SIMULATE ─► EXPOSE ─► RANK ─► BRIEF ─► APPROVE ─► CALL ─► EXTRACT ─► RE-RANK
   ▲                                                                                                  │
   └───────────────── every 5 min while the incident is open, and on every new report ◄───────────────┘
```

Each step is a method on `IncidentService`, so the HTTP API, the Telegram bot
and the agent's tools all drive the same code.

## The one safety property worth stating plainly

**The language model cannot place a phone call.**

Not because it is instructed not to — because there is no code path from it to
the voice service. `IncidentService.dispatchApprovedCall` is the only caller of
`VoiceService.dispatch`, and it writes a decision record naming an actor before
it does anything else. The agent's `propose_call` tool raises an approval card
and returns; the Telegram button and the web button both land on the same
decision endpoint.

Two rails then sit in front of the dispatch itself:

- `CALL_ALLOWLIST` must contain the number. Empty by default, which means no
  outbound calls at all.
- `EXERCISE_MODE` is on by default and prefixes every message and call with
  "SIMULACRO".

## Degradation

The design rule throughout: **during an incident a partial answer beats an error
page**, and every degraded answer says so.

| Upstream fails | What happens |
|---|---|
| DeepFire static-source mask | Nothing is masked, and the incident says so. Masking blind would be worse than not masking. |
| DeepFire fire-spread | Buffered rings around the last perimeter, carrying `probabilityFloor: 0` — the flag every consumer reads to label them a drawn circle rather than a prediction. |
| Talaia exposure | Six-rung ladder: retry, no live OSM, tile-split, summary-only, last-good, recorded fixture. The mode is stored on the exposure and shown on screen. |
| Nebius | Briefings fall back to a deterministic template containing exactly the same facts. Transcripts are not extracted, and the ranking is explicitly left unchanged. |
| SLNG telephony | A browser voice session with the identical script. Recorded as `web`, never as a phone call that reached the site. |
| Basemap tiles | The fire and the assets render on a flat ground. |
| Postgres | Configured-but-unreachable is a misconfiguration and fails loudly. Unset is a supported mode and runs in memory. |

## Data flow for one incident

1. **Watcher** (every 5 min) asks DeepFire for active clusters in the area of
   interest, then one batched query for all their detections.
2. **Clean** applies the rules in `docs/02-data-pipeline.md`. Nothing is
   deleted; every excluded pixel keeps the reason it was excluded.
3. **Confirm** scores the cluster 0–100 from named components. At or above 60 an
   incident opens and the pipeline runs — once, on the transition.
4. **Spread** submits a 10-member, 6-hour ELMFIRE run and polls it, inside
   DeepFire's two-in-flight budget, giving up at ten minutes.
5. **Bands** turn the result into cumulative hourly footprints cut at a 0.2 burn
   probability, which is what Talaia accepts as an area of interest.
6. **Exposure** posts those bands to Talaia, which assigns every asset to the
   earliest band that reaches it.
7. **Rank** computes spare time per site and applies the protective-action rule
   table.
8. **Brief** generates six lines from injected facts and pushes them to the
   coordinator unprompted.
9. **Approve → call → extract → re-rank** closes the loop with what the site
   actually said.
