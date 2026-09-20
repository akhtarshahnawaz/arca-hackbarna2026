# Modes, and the feed of active fires

## The two modes

One control, top centre, and it is the most important thing on the screen to get
right. It is the difference between "eight hundred people are in the path of
this fire" and "eight hundred imaginary people are in the path of an imaginary
fire".

| | Live | Synthetic |
|---|---|---|
| Left rail lists | Active DeepFire clusters in the chosen area | Generated scenario bundles |
| Detections | DeepFire, now | Recorded in the bundle |
| Fire spread | DeepFire simulation, requested on selection | Recorded in the bundle |
| Exposure | Talaia, live | Talaia if it answers; the bundle's own exposure otherwise |
| Incident badge | none | `synthetic`, in the top bar and on every card |

The mode is never set silently. A deployment with no DeepFire credentials opens
in synthetic mode with the live option disabled and a tooltip saying why, rather
than showing an empty list and letting the operator work out that half the
system is switched off.

Switching modes clears the incident on screen if it belongs to the other world.
A synthetic fire must never be left on the map while the header says Live.

## The feed

`GET /api/clusters` returns **every active cluster**, not only the ones that
clear the confirmation bar, each with the score that judged it.

This was a deliberate reversal. An earlier build showed only incidents, which
meant that on a normal day — nine active clusters in Catalonia, all of them
flares, kilns and single uncorroborated pixels — the screen showed nothing at
all, and an operator had no way to tell "the system is working and there is
nothing to report" from "the system is broken".

So the rejects are in the list, greyed, grouped under a count, with the reason:

> **la Pobla de Mafumet** — 0 of 151 det · 2 sat · 19:08Z
> All 151 dropped: known heat source.
> `NOISE` `PERIMETER` `151 MASKED`

That is the Tarragona petrochemical complex, correctly masked. A bare "0
detections" would have invited exactly the wrong conclusion.

### What each cluster carries

DeepFire's cluster record has four fields — id, first seen, last seen, active —
which is not enough to choose between two of them. Everything else is derived
from that cluster's own detections in the same pass the watcher already makes,
so browsing the feed costs no extra queries per cluster:

| Field | Why it is there |
|---|---|
| `place` | A name someone can act on. See *Place names* below |
| `detections` / `rawDetections` | How much survived cleaning, out of how much arrived |
| `dropped[]` | Why the rest did not, in the words the UI prints |
| `sources` | Every satellite that reported it |
| `corroboratingSources` | Of those, the ones whose detections survived. Two independent families is the corroboration bar |
| `maxFrpMw`, `totalFrpMw` | Radiative power: how hot, not just how many pixels |
| `spanM` | Greatest distance between two usable detections — a size proxy before a perimeter exists |
| `hasPerimeter` | DeepFire has fitted a perimeter, which is itself evidence |
| `score`, `classification` | The confirmation score, and what it decided |
| `incidentId` | Set once ARCA is working this cluster |

### Two queries, not fifty

The survey makes exactly four upstream requests regardless of how many clusters
come back: the static mask (cached for a day), the cluster list, one hotspot
query filtered by `cluster_id IN (…)`, and one perimeter query the same way. An
earlier version fetched perimeters one cluster at a time, which was fine for the
handful that cleared the bar and would have been fifty round trips for a feed
that shows all of them.

### Caching

A survey is reused for 60 seconds. The satellites feeding it are in polar orbit
— the fastest revisits a point a few times a day — and the geostationary feed
updates every ten minutes, so re-querying faster costs DeepFire requests and
returns the same features. An open operations screen polls the cache.

`?force=true` bypasses it. That is what the rescan button in the rail sends.

### A failed poll does not blank the screen

If the survey throws, the last good one is returned with `error` set, and the
rail prints the error above the list it already had. Showing stale data beside
the reason it is stale is better than replacing a screen that was correct a
minute ago with nothing.

## Working a cluster

`POST /api/clusters/:id/adopt` opens an incident for any cluster in the feed and
starts the pipeline on it. The pipeline is not awaited: a simulation takes
minutes, and the screen should show the incident immediately and fill in over
the event stream.

The confirmation bar stays exactly where it is — it exists so ARCA does not wake
anyone at 3 a.m. for a flare, and adoption does not move it. This is the other
half of that contract: a coordinator looking at the feed can point at anything
and say "work that one". When they do, the incident's timeline records that a
human asked and what the score was at the time:

> Opened by an operator at 0/100, below the noise threshold. No positive
> evidence.

Adopting a cluster that is already being worked returns the existing incident
and announces nothing. It is idempotent, like everything else keyed on a cluster
id.

## What live exposure actually looks like

Worth knowing before a demo. A Talaia query over a fast-moving fire's six-hour
footprint is not a handful of schools:

| | One live Empordà run |
|---|---|
| Footprint | 1,066 km² |
| Assets returned | 2,022 |
| Above the reach threshold | 1,220 |
| People | 109,104 — of which **80,750 from class defaults**, 28,478 from registries |
| Actions | 468 evacuate now, 260 shelter candidates, 437 prepare, 55 resources |

Two consequences the UI has to handle, and does:

- **The ranked list is paged.** Twenty-five rows, then a button that names how
  many more are above the reach threshold. A scrolling column of 1,220 rows is
  not a ranked list, it is a haystack.
- **Every headcount says where it came from.** "Estimated for this kind of site"
  is not "registered", and with live data most of them are the former.

It also drove the ordering change in
[Ranking](./03-ranking.md#why-spare-time-is-not-compared-minute-by-minute):
sorted strictly by minute, unnamed field parcels filled the top of the list
ahead of the care homes.

## Where to look

Catalonia is the default because that is where Talaia's registry coverage is
deep. It is also, for most of the year, empty.

On the afternoon this was written the Catalan feed held nine active clusters and
ARCA scored every one as noise. That was correct: eight were single pixels of
1–13 MW seen by one satellite, and the ninth was 197 detections over 52 hours at
la Pobla de Mafumet — the Repsol Tarragona petrochemical complex, masked. There
was genuinely no wildfire in Catalonia.

There were three in Iberia. Widening the area to `iberia` found them:

| | Detections | Satellites | Peak FRP | Across | Score |
|---|---|---|---|---|---|
| Vila Nova de Poiares, Coimbra | 134 of 325 | 3 | 620 MW | 9.5 km | 100 CONFIRMED |
| Villablanca, Huelva | 327 | 6 | 861 MW | 5.7 km | CONFIRMED |
| A Lama, Pontevedra | 132 | 4 | 142 MW | 10.0 km | CONFIRMED |

So the picker offers three areas, and says what each costs:

| Area | Bounding box | Exposure |
|---|---|---|
| Catalonia | `0.15,40.50,3.35,42.90` | Full registries: capacities, contacts, REGA livestock |
| Spain and the Balearics | `-9.50,35.90,4.40,43.90` | Catalan registries only; OpenStreetMap elsewhere |
| Iberia and the Maghreb | `-10.00,30.00,5.00,45.00` | OpenStreetMap outside Catalonia |

`AOI_BBOX` still sets the default and still drives the background watcher; the
picker only changes what the screen is looking at.

### Two things a wide area breaks, and how

**URL length.** The hotspot query filters by `cluster_id IN (…)`, which is cheap
for nine clusters and a 414 for a hundred and eighty — seven kilobytes of UUIDs
in a query string. Above sixty ids the filter is dropped and the bounding box
and time window do the work instead, with the results bucketed by cluster
locally. Same detections, shorter URL.

**Nominatim's one request per second.** Naming 185 clusters would take three
minutes of queue for a list whose bottom nine tenths is collapsed behind "scored
as noise". Only the top thirty are named — already being worked first, then by
score — and the rest fall back to coordinates. The cache is shared across
surveys, so anything that stays near the top is named once and free after that.

**The static mask is per-area too.** A Catalan mask says nothing about a flare
stack in Huelva, so widening refetches it. Masking blind would be worse than not
masking.

## Waiting for the model

A DeepFire simulation queues and takes minutes. An earlier build showed a
detection and then nothing at all for those minutes — no footprint, no ranked
list, no sign anything was happening — which reads as broken rather than busy,
and wastes the part of an incident where minutes are worth most.

So opening a fire now happens in two passes:

1. **Immediately.** Concentric rings are drawn from the ignition at a blunt
   1.4 km/h and Talaia is asked what is inside them. A ranked list of who is
   nearby appears in seconds. The map caption, the legend and the spread record
   all say `provisional`, and the timeline records that the figures will be
   recomputed.
2. **When the model lands.** The real ensemble replaces the rings, the ranking
   is recomputed, and the [diff](./03-ranking.md#the-diff) says exactly what the
   model changed about the order.

It costs one extra exposure query, and only on the first open of an incident
that has no completed run — a re-open uses the cached one, and a replay skips
the pass entirely because its geometry is already recorded.

### What caching does and does not fix

Worth being straight about, because "add a cache" is the obvious suggestion and
it does not solve the slow case:

| | Cached | For how long |
|---|---|---|
| Cluster survey | yes, per area | 60 s |
| Static heat-source mask | yes, per area | 24 h |
| DeepFire token | yes, in the store | 180 days |
| Completed simulation | yes, per incident | 30 min before a re-run is considered |
| Talaia exposure | yes, per incident | for the incident's life |
| Place names | yes | 7 days |

Every one of those makes the *second* open fast. None of them helps the first,
because the first is a model run that has never been computed. The provisional
pass is what addresses that, and running ARCA with `DATABASE_URL` set is what
stops every restart from throwing the caches away.

## Place names

DeepFire clusters have no name. `PlaceResolver` reverse-geocodes the cluster
position through Nominatim, which is the right tool for the job and a service
run on donated hardware, so three rules are enforced in the resolver rather than
left to callers:

- identify the client in `User-Agent`;
- never exceed one request per second, kept by a serialised queue;
- cache hard — keyed to ~100 m, which is finer than a cluster moves in a day,
  and held for a week.

A survey resolves names within a 3-second budget. Whatever lands inside it is
returned; the rest come back `null`, are warmed in the background, and appear on
the next poll. A name is a nicety and is never allowed to delay a survey.

Set `PLACE_LOOKUP=false` for a deployment that would rather not send coordinates
to a third party. Clusters are then labelled with their coordinates.

## Scenarios

`GET /api/scenarios` reads each bundle in `fixtures/replay/` and returns a
description, rather than a list of file names. "demo bages synthetic" asks the
operator to guess; this does not:

> **Alt Empordà** — Alt Empordà, Catalunya
> Tramuntana fire above the Golf de Roses, driven hard to the south at 17 m/s.
> Two large campsites at September occupancy: the case where evacuation time,
> not distance, decides the order.
> `31 DETECTIONS` `10 SITES` `3.6K PEOPLE`

Three ship, chosen because the interesting differences between fires are not in
the flames:

| Scenario | What it exercises |
|---|---|
| **Sant Fruitós de Bages** | The base case. Moderate wind, farms, a school, a care home. A quarry and a stray pixel in the feed for the cleaning rules |
| **Alt Empordà** | Tramuntana at 17 m/s and campsites at September occupancy. Several sites out of evacuation time at once — the shelter-in-place branch |
| **Massís del Garraf** | Wildland-urban interface. A hazardous industrial site and a hospital in the same path, which is where the action rules diverge |

They are generated by `apps/agent/scripts/make-scenarios.ts` and regenerated
with `pnpm demo:bundle`. Every one carries `synthetic: true`, a note saying so,
and a `blurb`; the incident they open is badged `synthetic` everywhere it
appears.

### Naming, and the one trap in it

Incidents are named for the operator — "Alt Empordà", not
"demo-emporda-synthetic". The Talaia failsafe's last rung looks a bundle up by
the incident's name, so `ReplayService.resolveName` resolves file name first and
then label. If that link breaks, every scenario silently loses its bundled
exposure, which is why there is a test for it.
