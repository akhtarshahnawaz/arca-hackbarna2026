# Testing, replay and the demo

## Running the tests

```bash
pnpm test          # 90 tests, no network, no database
pnpm typecheck
```

| Package | Covers |
|---|---|
| `@arca/core` (72) | Geometry, cleaning rules, confirmation scoring, band construction, reach statistics, evacuation model, action table, ranking order, diffs |
| `@arca/db` (8) | The store contract, including the two behaviours a re-rank must preserve |
| `@arca/agent` (10) | The pipeline end to end, with Talaia and the extractor stubbed |

Everything runs against the in-memory store, which is why the suite needs no
container.

## Bugs these tests caught while being written

Listed because they are the argument for having them.

1. **A duplicate radius that merged one fire into fewer detections.** A fixed
   375 m radius collapsed neighbouring VIIRS pixels along a real fire front,
   shrinking the ignition set. The radius now scales with the sensor's pixel.
2. **A tie-break that preferred the wrong reading.** Radiative power led
   confidence, so a LOW pixel reporting marginally more energy suppressed the
   HIGH one beside it, and the cluster looked less certain than the data was.
3. **A forward scan that could not look backwards.** Duplicate suppression only
   ever removed the later record, so a weak pixel delivered a minute early
   survived and the high-confidence reading was discarded.
4. **A confirmation score with no floor.** Only corroboration scored, so a real
   fire seen once by one polar satellite scored 10 and was filed as noise.
5. **A diff that hid the most important move.** A minimum-two-places threshold
   filtered a one-place move *into first* as noise, hiding the swap a phone call
   had just caused.
6. **A lying return value.** `applyTranscript` reported `reranked: true` even
   when no model run existed to re-rank against, leaving a stale order on screen
   while the caller believed it had updated.

## Replay

A wildfire system has an obvious demo problem: there may be no wildfire.

Replay solves it honestly. A recorded fire is played back through the identical
cleaning, banding and ranking code — the only difference is where the bytes come
from, and every replay incident is flagged so it cannot be mistaken for live.

```bash
curl -X POST http://localhost:4000/api/replay/demo-bages-synthetic
```

Or click it on the landing screen.

### The shipped bundle

`fixtures/replay/demo-bages-synthetic.json` is **generated, and says so** in its
name, a `synthetic` flag, and a note carried into the incident. Nothing in it is
presented as recorded satellite data.

The geography is real — Sant Fruitós de Bages, north-east of Manresa — and the
shape matches the real APIs exactly, because the point is that the pipeline
cannot tell the difference.

It deliberately contains three things a clean feed would not:

- a quarry two satellites keep reporting, which the static mask excludes;
- a lone low-confidence pixel in its own cluster, which the corroboration rule
  excludes;
- a geostationary re-report of the same coarse pixel, which the duplicate rule
  collapses.

A demo without them would not show the product working.

Regenerate or edit it:

```bash
pnpm --filter @arca/agent exec tsx scripts/make-demo-bundle.ts
```

### Scrubbing time

`POST /api/replay/:name?asOf=2026-09-19T12:10:00Z` filters detections to those
observed by that moment and **recomputes the confirmation score**, so scrubbing
back shows the incident as ARCA would genuinely have seen it — often below the
confirmation bar, which is the point.

## The three-minute demo

1. **Open on the incident picker.** Usually empty, and say why: ARCA opens an
   incident only above 60/100, so a flare or a quarry never becomes one.
2. **Start the replay.** Hover the confirmation score. Two satellites agree,
   detections persisted 61 minutes, peak 270 MW — and two detections masked as a
   known quarry. That is the difference between an alert and a false alarm.
3. **Press play.** The fire grows hour by hour and the figures recount: 439
   people exposed in the first two hours, 1,247 across six. The footprint is
   DeepFire's own probability ramp, so both products describe one fire
   identically.
4. **Read the list.** The care home is first, not the school — 64 residents
   needing 3.6 hours to move against 60 minutes of warning. Negative spare time
   makes it a shelter-in-place candidate, which the copy frames as urgency
   rather than an order.
5. **Show the phone.** The briefing arrived without being asked for. Ask "why is
   the care home first?" and the agent answers from tool calls.
6. **Approve a call.** With an empty allowlist a browser voice session opens
   instead — say so, because the screen does. The site reports 38 residents, 12
   in wheelchairs.
7. **Watch the list move.** The evacuation estimate grows, the diff names the
   reported figures as the cause, and the timeline has the whole chain with
   actors and timestamps.

Close on the sentence the product is built around: **DeepFire says where the
fire may go. Talaia says what is there. ARCA says who to call first.**

## Manual checks worth doing

| Check | Expected |
|---|---|
| Message the bot from a phone that never touched it | An explanation of ARCA and nothing about any incident |
| Approve a call with an empty allowlist | A web session, the timeline saying no call was placed, and no silent success |
| Stop the Talaia key mid-incident | Exposure degrades down the ladder, the mode appears on screen, the incident stays open |
| Paste an unparseable transcript | "the ranking is unchanged", and the report is not written |
| Block the basemap | Fire and assets still render on a flat ground |
