# Reading the map

Three things share one rectangle: where the fire may go, what a satellite
actually saw, and what is in the way. Each gets its own visual channel, and no
channel is ever asked to carry two meanings.

| Channel | Carries |
|---|---|
| Warm gradient | Burn probability |
| Small dots | Satellite detections |
| Disc colour | The recommended action for a site |
| Disc shape | What kind of place it is |

## The fire is one surface, not a stack of rings

The model returns nested probability contours — five levels — for each of six
hours. Drawn naively that is **thirty polygons**, and at the end of the horizon
they crowd into a dartboard. Two changes fix it.

**One hour at a time.** `spreadFrames` unions each probability level forward
through the hours, so every frame is a complete picture of the fire at that
moment rather than that hour's delta. The map filters to exactly one hour —
`["==", ["get","hour"], h]` — and with no hour selected it shows the last frame,
which is the full horizon. Five polygons on screen, never thirty.

Unioning forward is not cosmetic. Each hour is fitted independently, so the
model can return a slightly smaller polygon at hour 4 than at hour 3; played
back, the fire pulses. A fire does not un-burn ground, and a cell that could
burn by hour 3 can still burn by hour 4, so carrying it forward invents nothing.

**Feathered boundaries.** Five nested fills still give five visible steps, and a
stepped fire reads as five separate fires. MapLibre cannot blur a fill, so each
contour's boundary is over-drawn with a wide, heavily blurred line in its own
colour (`spread-feather`). The steps melt into each other and what is left is a
gradient. It sits exactly on a boundary the fill already drew, so it adds no
area and claims nothing.

**One outline, on the outermost contour only.** "How far might it get" is a
single question with a single answer. An edge on every level turns the gradient
straight back into rings.

Fill opacity tops out at 0.22 in the core. Any stronger and the villages
underneath stop being legible, which is the one thing this map may not do — the
whole point is seeing which village is inside the perimeter.

### When it is not a model run

A drawn footprint — while the simulation is still queued, or after one has
failed — is a flat ring set carrying `probabilityFloor: 0`. The legend changes
its heading to *Provisional footprint* or *Footprint*, the caption says so, and
the ranked list built on it is labelled the same way. It is never coloured as if
it were a probability surface.

## Detections

Each dot is one pixel a satellite reported. Radius scales with fire radiative
power, so a 300 MW pixel is visibly bigger than a 5 MW one.

**Hollow grey circles are masked detections** — pixels dropped as known
persistent heat sources. They are drawn, not deleted, and hovering one names the
flare, kiln or quarry it was excluded for. A coordinator who sees a bright pixel
on another system and nothing on ours must be able to find it here with a
sentence saying why; a missing dot is not an answer.

Toggle them in the legend.

## Sites

**Colour is the instruction.** One colour per protective action, identical on
the map, in the ranked list and in the legend. Warm means the fire, cool means
an instruction about people, and red is the single crossover because "evacuate
now" is the one instruction that is about the fire arriving.

**Shape is the place.** Colour can only carry one meaning at a time without
becoming a puzzle, so the kind of place is a white pictogram drawn on the disc:

| | |
|---|---|
| Cross | Hospital or clinic |
| Bed with a headboard | Care home |
| Open book | School or nursery |
| Tent | Campsite |
| House | Housing |
| Fence | Livestock |
| Works with a chimney | Industry |
| Bolt | Utility |
| Shield | Emergency service |
| Bed | Hotel or lodging |

Every glyph is a silhouette rather than a drawing. At eighteen pixels on a wall
display, detail is noise; what survives is the outline.

They are drawn in the browser with a canvas and registered through
`map.addImage`, which is why there is no sprite sheet to keep in step — and the
legend calls the same drawing code, so the key cannot drift from the marks it
describes. Plain raster rather than SDF: SDF would let one set be tinted at
runtime, but generating distance fields for eleven glyphs costs more than
drawing eleven white ones, and white reads on every colour in the palette.

`icon-allow-overlap` is on. A hospital that disappears because a campsite is
nearby is worse than two marks touching.

Classification is by subcategory first, then category — Talaia's categories are
broad, and a campsite and a marina are both `tourism` while only one of them
sleeps four hundred people in tents. The mapping lives in
`apps/web/src/components/siteIcons.ts`.

**Dark collars.** Every marker sits on a ring of the page background. Without it
a red site on an orange fire is invisible, which is exactly where sites matter
most.

## The scrubber

Plays the horizon hour by hour and loops, so a wall display left alone keeps
showing the fire moving rather than freezing on the last frame looking broken.

The consequence figures sit beside it rather than in the side panel, because
they are a function of the hour it selects. Dragging to +3h and watching
*people* climb is the argument for having a scrubber at all; the same three
numbers in a separate box read as static trivia.
