# Ranking: who to call first

Configuration:
[`ranking-policy.json`](../packages/core/src/config/ranking-policy.json) ·
[`evac-times.json`](../packages/core/src/config/evac-times.json) · served by
`GET /api/policy`.

## The equation

```
spare time  =  time until the fire arrives  −  time needed to empty the site
```

Sorting by spare time ascending puts the site that runs out of time first at the
top. That is a different list from "biggest" or "most valuable", and it is the
only one that answers who to call first.

A large school with four hours of warning is not more urgent than a small care
home with twenty minutes. Talaia's life-safety priority score breaks ties; it
never leads.

## The half nobody publishes

Fire models are everywhere. How long it takes to get sixty-four dependent
residents out of a care home at two in the morning is institutional knowledge
that lives in people's heads.

ARCA states its assumptions, versions them in config, serves them over the API
and repeats them in every explanation — so that the first thing a fire officer
does with this system is correct them. That is the intended use.

| Site type | Fixed overhead | Per person |
|---|---|---|
| Hospital | 120 min | 1.5 min |
| Care home | 90 min | 2.0 min |
| Campsite | 60 min | 0.5 min |
| Primary care | 45 min | 0.5 min |
| Secondary school | 45 min | 0.2 min |
| Nursery, primary school | 40 min | 0.3 min |

Plus **4 minutes for each person reported unable to walk unaided**, which is
what actually dominates a care-home evacuation and is only ever known from a
phone call.

Livestock is charged per 100 animals by species, because animals cannot
self-evacuate and lead time is the whole problem:

| Species | Minutes per 100 |
|---|---|
| Poultry, rabbits | 20 |
| Goats | 36 |
| Sheep | 45 |
| Cattle | 75 |
| Horses | 120 |
| Pigs | 150 |

Capped at 12 hours. Beyond that the answer is not evacuation, it is
defend-in-place with Bombers, and pretending otherwise would make the ranking
dishonest.

## Occupancy: reported beats registered

| Basis | Meaning |
|---|---|
| `reported` | A person said it on the phone at a recorded time |
| `registered` | A registry maximum — **not** live occupancy |
| `unknown` | No figure available |

Every figure on screen carries its basis. A school's enrolment is not the
children present at 3 a.m.

A reported **zero** and **not stated** are different values and are never
conflated — one means the building is empty, the other means nobody has checked.

## Protective actions

Evaluated in this order, which is deliberate:

| Order | Action | Condition | Why here |
|---|---|---|---|
| 1 | **Monitor** | `p_reach` < 0.3 | Below the watch threshold |
| 2 | **Exclusion zone** | Hazardous and arriving within 60 min | Aimed at responders, not occupants. Telling a fuel depot to evacuate its zero residents would bury the fact that nobody should drive an engine past it |
| 3 | **Shelter-in-place candidate** | `spare < 0` | The clock has run out. Sending people onto a road the fire is about to cross is worse than keeping them in a building |
| 4 | **Evacuate now** | `0 ≤ spare < 180 min` | There is time, but movement has to start |
| 5 | **Resource at risk** | A response asset with time | Losing it removes capacity mid-incident |
| 6 | **Prepare** | Everything else | Warn and ready vehicles |

Shelter-in-place outranks evacuate because when the clock has already run out,
the safer instruction is the opposite one. ARCA never phrases it as an order:
the copy says *urgency, not an order — the coordinator decides with Bombers*.

## Certainty tiers

| Tier | `p_reach` | Placement |
|---|---|---|
| Likely | ≥ 0.7 | Main list |
| Possible | 0.3 – 0.7 | Main list |
| Watch | < 0.3 | Watch list, collapsed |

Reported as runs rather than percentages — "in 7 of 10 runs the fire reaches
this site within 2 h" — because that is how the uncertainty was generated.

## Ordering and stability

1. Spare time ascending, **at the precision it is actually known to**. No clock
   at all sorts last.
2. More runs agreeing.
3. Talaia's priority score.
4. Asset id.

The last tiebreak exists only so the order is stable across recomputations and
the screen does not shuffle rows that did not actually move.

### Why spare time is not compared minute by minute

Spare time is an ensemble arrival estimate minus a parametric evacuation model.
Neither is accurate to the minute, and the error grows with the magnitude:
"twelve minutes short" is a real distinction, "twelve minutes apart at thirteen
hours short" is noise in both models.

Sorting on the raw minute treats those identically, and at scale that has one
specific, bad consequence. A live Talaia query over a large footprint returns
thousands of assets — one Empordà run came back with 2,022 — most of them field
parcels carrying a class-default headcount of two. Sorted strictly by minute, an
unnamed sheep shed 13.1 hours short outranks a care home 12.9 hours short. Both
lose the race; only one of them is who you call first.

So spare time is compared on a signed log scale: roughly five-minute resolution
near zero, where the distinction decides an action, widening to hours out in the
region where nothing arrives in time anyway. The transform is monotonic, so a
genuinely shorter clock still sorts first — there is a test that walks it from
−2000 to +2000 minutes to keep it that way.

### Where the headcount came from

With live registry data most headcounts are class defaults — "a farm building
holds about two people". On the Empordà run, 80,750 of 109,104 people came from
defaults and 28,478 from registries. Every row says which it is, because
printing a rule of thumb as "registered" dresses it as a record.

## What a re-rank must never lose

A ranking pass owns `rank` and `action`. It does **not** own `status` or
`reported`: those belong to the coordinator's workflow. Both store
implementations enforce this, and it is the property the pipeline test asserts
directly — it is exactly what the previous build got wrong.

## The diff

A re-rank that silently reshuffles the screen is worse than no re-rank, because
the person watching has to re-read the whole list to find out whether anything
moved.

`rankingDiff` reports action changes, moves of two or more places inside the top
ten, and **any movement at all within the top three**. Becoming the site that
runs out of time first is the single most important thing that can change, and
an earlier version filtered a one-place move into first as noise — hiding the
swap a phone call had just caused.

Diffs are phrased with their cause:

> Escola Monsenyor Gibert #3 → #1, now shelter-in-place candidate: reported 280
> people on site instead of 312 registered; 40 unable to walk unaided;
> evacuation need 134 min → 284 min.
