# Detection, cleaning and confirmation

Every threshold on this page lives in
[`packages/core/src/config/cleaning-policy.json`](../packages/core/src/config/cleaning-policy.json)
and is served by `GET /api/policy`, so a coordinator can read what the engine
used and argue with it.

## Sources

DeepFire fuses fifteen sensors whose pixels differ by two orders of magnitude.
Everything downstream that reasons about position needs to know which family a
detection came from.

| Class | Sensors | Pixel |
|---|---|---|
| `landsat` | Landsat 8/9 OLI | 30 m |
| `viirs` | Suomi NPP, NOAA-20, NOAA-21 | 375 m |
| `modis_class` | MODIS, Sentinel-3 SLSTR, MetOp AVHRR | 1–1.1 km |
| `geostationary` | MTG-I1, Meteosat 9/10, GOES 18/19, Himawari-9 | 2–3 km |

## Cleaning rules

Applied in order. **Nothing is deleted.** A coordinator who sees a bright pixel
on another system and not on ARCA must be able to find it here, greyed out, with
a sentence saying why. "This is the Tarragona refinery flare" is an answer; a
missing dot is not.

### R1 — Static heat sources

A detection is masked when its pixel centre falls inside a known persistent heat
source, or within roughly one pixel footprint of it.

| Sensor class | Buffer |
|---|---|
| landsat | 200 m |
| viirs | 750 m |
| modis_class | 1 500 m |
| geostationary | 3 000 m |

A 30 m Landsat pixel and a 3 km Meteosat pixel cannot share one exclusion
radius: one would leak flares, the other would mask real fires. At 3 km per
pixel, the centre of a Meteosat detection sitting next to a refinery tells you
nothing about which of the two is burning.

The mask is fetched once a day and indexed on pre-expanded bounding boxes, so
the hot loop is four numeric comparisons per polygon rather than a point-in-
polygon test.

### R2 — Uncorroborated low confidence

A `LOW` detection survives only if its cluster also has a `HIGH` detection or
detections from two distinct satellites. A single low-confidence pixel is sun
glint or a gas flare as often as it is fire.

### R3 — Same-sensor duplicates

The same satellite re-reporting the same pixel. The radius scales with the
sensor: **half a pixel footprint, floored at 60 m**.

A fixed radius is wrong in both directions. Wide enough for Meteosat, it merges
neighbouring VIIRS pixels of one large fire and quietly shrinks the ignition
set. Tight enough for VIIRS, it lets genuine Meteosat re-reports through as
separate fires.

When two records describe the same pixel, **confidence leads and radiative power
only breaks ties within a grade**. A HIGH and a LOW reading of the same ground
are not two opinions of equal weight.

This runs as a separate grouping pass rather than a rule inside the main loop,
because the decision is about a group: the strongest reading wins regardless of
which record arrived first. A forward scan could only ever suppress the later
one, so a weak pixel delivered a minute early survived and the high-confidence
reading beside it was discarded — exactly backwards.

The lookup sweeps the 26 neighbouring cells as well as the home cell. Checking
only the home cell is the classic boundary bug: two detections five minutes and
one metre apart can still fall either side of a cell edge and never be compared.

### R4 — Staleness

Older than 12 hours: kept on the map as history, excluded from the ignition set.

## The confirmation score

A single number would be a black box. The components are stored with the
incident and shown on hover, so the reason ARCA woke someone at 3 a.m. is
legible.

| Component | Points | When |
|---|---|---|
| Credible detection | +20 | Any polar-orbit detection graded MEDIUM or better |
| Independent satellites agree | +40 | Two or more distinct sources |
| Persisted across passes | +25 | Detections span 20 minutes or more |
| High-confidence pixel | +15 | Any HIGH detection |
| Moderate radiative power | +10 | Peak FRP ≥ 20 MW |
| Strong radiative power | +20 | Peak FRP ≥ 50 MW |
| Satellite perimeter computed | +10 | DeepFire has fitted a perimeter |
| Geostationary only | −30 | Every surviving detection is a 2–3 km pixel |
| Nothing survived cleaning | −100 | Cluster is a static source |

**≥ 60 confirmed** · **30–59 candidate** · **< 30 noise**

The credible-detection floor exists because an earlier version only rewarded
corroboration, so a real fire seen once by one polar satellite scored 10 and was
filed as noise. That is the opposite of what an early-warning system should do.

## From ensemble to arrival bands

The shape of DeepFire's output was verified against its own renderer rather than
assumed. A completed run returns one FeatureCollection whose features each carry
`hour`, and on an ensemble run also `burn_probability` — the share of members
that had burned that polygon by that hour. **There are no per-member polygons.**

DeepFire's web app detects the ensemble case with
`features.some(f => f.properties.burn_probability !== undefined && f.properties.burn_probability < 1)`,
colours by probability at 0.2/0.4/0.6/0.8/1.0 and weights burned area by it.
ARCA reads the same field the same way, so both products describe one fire
identically.

From that:

- **Band for hour `h`** = union of the hour-`h` polygons at or above a 0.2 burn
  probability, accumulated over hours. Cumulative rather than annuli because
  Talaia assigns each asset to the earliest band that reaches it; disjoint rings
  would drop anything on a boundary.
- **`p_reach`** = the highest probability of any polygon containing the site at
  the horizon. Correct whether the model emits nested contours or a partition.
- **Conservative arrival** = the first hour at or above 0.2, which with ten
  members means at least two runs burned that ground by then.
- **Majority arrival** = the first hour at or above 0.5, reported alongside so a
  coordinator can see how pessimistic the first number is.

Planning an evacuation against the median means being wrong half the time in the
direction that kills people. That is why the clock uses the conservative figure.

## Weather

Wind and humidity come from Open-Meteo: free, keyless, and therefore unable to
stop an incident briefing because a credential expired. DeepFire's simulation
also returns the average wind it used, but that is one number for the whole run;
the forecast is what tells a coordinator the wind is about to swing at four.
