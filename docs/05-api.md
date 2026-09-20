# HTTP API

Base URL: the agent service, `http://localhost:4000` by default.

## Authentication

Set `OPS_TOKEN` to turn authentication on. Any non-empty value enables it; leave
it unset and the API is open to anyone who can reach it, which is flagged at
boot.

Send it as `X-Ops-Token`, `Authorization: Bearer …`, or `?token=` on the event
stream (browsers cannot set headers on `EventSource`). Compared in constant
time, so the token cannot be guessed a byte at a time.

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

### `GET /api/replay` · `POST /api/replay/:name?asOf=<iso>`

List and start replay bundles. `asOf` filters detections to those observed by
that time and recomputes the confirmation score, so scrubbing back shows the
incident as ARCA would genuinely have seen it — often below the confirmation
bar.

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
