# HTTP API

Base URL: the agent service, `http://localhost:4000` by default.

## Authentication

Set `OPS_TOKEN` to turn authentication on. Any non-empty value enables it; leave
it unset and the API is open to anyone who can reach it, which is flagged at
boot.

Send it as `X-Ops-Token`, `Authorization: Bearer …`, or `?token=` on the event
stream (browsers cannot set headers on `EventSource`). Compared in constant
time, so the token cannot be guessed a byte at a time.

The web app holds it in local storage and puts up a prompt the first time
anything returns 401. It cannot be shipped as a `NEXT_PUBLIC_*` variable,
because that compiles the secret into a bundle anyone can read.

`/api/health` and `/api/telegram/webhook` are always open — the first so a
platform health check works, the second because it carries its own Telegram
secret.

This is not an identity system. It is one deployment for one operations room,
and what it provides is the difference between "anyone who finds the URL" and
"someone the team gave the token to" — the gap that matters when the payload
includes facility phone numbers.

## Reading

### `GET /api/health`

```json
{
  "status": "ok",
  "storage": "postgres",
  "capabilities": {
    "deepfire": true, "talaia": true, "nebius": true, "slng": true,
    "telegram": true, "outboundCalls": false, "database": true,
    "exerciseMode": true
  },
  "upstream": { "deepfire": true, "talaia": true },
  "exerciseMode": true,
  "at": "2026-09-20T01:34:19.667Z"
}
```

Returns 503 when DeepFire is configured but unreachable. `capabilities` is what
this deployment can actually do, and the UI uses it to disable controls that
would fail.

### `GET /api/policy`

Every threshold the engine used: cleaning, ranking and evacuation assumptions. A
policy the operator cannot read is a policy they cannot argue with.

### `GET /api/clusters?force=true`

The live feed: **every** active cluster in the area of interest, with the
confirmation score that judged it — including the ones scored as noise, and the
reason each detection was dropped.

```json
{
  "clusters": [{
    "clusterId": "5b03169d-8daa-4531-b05b-ba7231973da4",
    "position": [1.23098, 41.18126],
    "place": "la Pobla de Mafumet",
    "firstObserved": "2026-09-18T00:43:00Z",
    "lastObserved": "2026-09-19T19:08:34Z",
    "detections": 0,
    "rawDetections": 151,
    "maskedDetections": 151,
    "dropped": [{ "reason": "known heat source", "count": 151 }],
    "sources": ["MODIS_NRT", "VIIRS_SNPP_NRT"],
    "corroboratingSources": [],
    "totalFrpMw": null, "maxFrpMw": null, "confidence": null,
    "spanM": 0, "hasPerimeter": true,
    "score": 0, "classification": "NOISE",
    "incidentId": null, "incidentStatus": null
  }],
  "bbox": "0.15,40.50,3.35,42.90",
  "at": "2026-09-20T04:21:03.114Z",
  "error": null,
  "maskIncomplete": false
}
```

Served from a 60-second cache; `?force=true` bypasses it. When the upstream poll
fails, the **last good feed** is returned with `error` set rather than an empty
list. See [Modes and the feed](./10-modes-and-the-feed.md).

### `POST /api/clusters/:id/adopt`

Work a cluster, including one below the confirmation bar. Opens or updates the
incident, records on its timeline that an operator asked for it and what the
score was, and starts the pipeline **without awaiting it** — a simulation takes
minutes and the screen should fill in over the event stream.

Idempotent: adopting a cluster already being worked returns the existing
incident and announces nothing. 404 if the cluster has left the feed.

### `GET /api/incidents?includeClosed=false`

Open incidents with per-incident counts of ranked sites, sites to evacuate now,
shelter candidates and people.

### `GET /api/incidents/:id`

Everything one screen needs, in one response: `incident`, `hotspots`, `spread`
(bands and per-hour frames), `exposure`, `sites`, `calls`, `timeline`, `diffs`.

Deliberately not six endpoints. The map, the ranked list, the timeline and the
header all describe the same moment, and fetching them separately would let the
map show one ranking version while the list shows another.

`spread.synthetic` is true when the footprint is drawn rings rather than model
output, and must be labelled wherever it is displayed.

### `GET /api/events?incident=<id>`

Server-sent events: `timeline`, `ranking`, `call`, `incident`, plus a
`heartbeat` every 20 seconds because proxies close a stream that goes quiet and
an incident can legitimately be quiet for minutes.

Clients refetch on any event rather than patching from the payload, which keeps
one consistent view.

## Writing

### `POST /api/incidents/:id/decisions`

**The only endpoint that causes anything irreversible.** The Telegram button
calls the same service, so there is one audit trail.

```jsonc
{ "kind": "approve_call", "assetId": "tal_9f2c…", "actor": "coordinator", "language": "es" }
{ "kind": "deny",         "assetId": "tal_9f2c…", "actor": "coordinator" }
{ "kind": "set_status",   "assetId": "tal_9f2c…", "status": "evacuated", "actor": "coordinator" }
{ "kind": "note",         "note": "Bombers have a unit en route.", "actor": "coordinator" }
```

`approve_call` records the decision, then dispatches — in that order, so the
audit trail cannot be missing for a call that happened. The response says what
actually occurred, including when no call was placed and why.

### `GET /api/incidents/:id/sites/:assetId/script`

What the agent will open with, rendered from the same `CallScript` the call
receives: the SIMULACRO line when exercise mode is on, the greeting, the
situation and recommendation, and the four questions. Plus `wouldDial`, which
says whether this site's number is actually on the allowlist.

It stops after the questions on purpose — everything past that is a
conversation, and the payload says so rather than letting a tidy transcript
imply the whole call is scripted.

### `GET /api/incidents/:id/sites/:assetId/script/audio`

The same opening, synthesised through the voice the agent uses, as `audio/mpeg`.

This exists because `CALL_ALLOWLIST` is empty by default and should be — which
meant the most obvious question about a system that telephones care homes,
*what does it actually say*, had no answer anywhere in the product. An approval
opened a LiveKit room and synthesised nothing.

Accepts `?token=` as well as the header, because an `<audio>` element cannot
set one. 503 when `SLNG_API_KEY` is unset.

### `POST /api/incidents/:id/brief`

Send the briefing to `COORDINATOR_TELEGRAM_CHAT_IDS` now, with approval buttons
for the top sites. The pipeline briefs on its own when the watcher confirms a
fire, and every route a human drives passes `notify: false`; this is the
explicit button, and it sends the same briefing built the same way.

400 if Telegram is unconfigured or no coordinator ids are set.

### `POST /api/incidents/:id/transcript`

```json
{ "assetId": "tal_9f2c…", "transcript": "Somos treinta y ocho residentes…" }
```

The workflow without working telephony: paste what a site said, get it
extracted, ranked and diffed. Returns `{ summary, reranked }`, where `reranked`
is false and says so when no model run exists to re-rank against.

### `POST /api/incidents/:id/refresh?force=true`

Fresh simulation and re-rank. Slow — a run can take minutes.

### `POST /api/chat`

```json
{ "message": "why is the care home first?", "history": [] }
```

### `POST /api/watch/tick`

Run one watcher pass immediately instead of waiting for the interval.

### `GET /api/scenarios` · `POST /api/scenarios/:name/start?asOf=<iso>`

The synthetic scenarios, described well enough to choose between them — label,
place, a sentence on what the scenario exercises, detection and asset counts,
and the incident id if one is already open for it.

Starting one returns as soon as the detections and the recorded model run are
stored; the exposure query behind it can take a minute when Talaia is slow, and
a button that stays pressed for that long reads as a hang.

`asOf` filters detections to those observed by that time and recomputes the
confirmation score, so scrubbing back shows the incident as ARCA would genuinely
have seen it — often below the confirmation bar.

### `GET /api/replay` · `POST /api/replay/:name?asOf=<iso>`

The same bundles by file name, kept for scripts. `POST /api/replay/:name` awaits
the whole pipeline and reports how many sites were ranked, which is what makes
it useful in a test.

### `POST /api/telegram/webhook`

Verifies `X-Telegram-Bot-Api-Secret-Token`, acknowledges immediately, then
works. Telegram retries anything it does not get a prompt 200 for, and an agent
turn takes seconds.

## Errors

| Status | Meaning |
|---|---|
| 400 | Missing or invalid fields |
| 401 | Bad or missing ops token |
| 404 | No such incident, site or replay bundle |
| 500 | Unhandled — logged with the request path |
| 503 | `/api/health` only: DeepFire configured but unreachable |

Upstream degradation is never an error. It is a warning on a complete response,
carried in `exposure.degraded` and on the timeline.
