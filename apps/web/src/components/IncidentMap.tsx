"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSONSource,
  LngLatBounds,
  MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type FilterSpecification,
  type LayerSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RankedSite } from "@arca/core";
import type { HotspotView, SpreadFrameView, SpreadView } from "@/lib/api";
import { ACTION_STYLE, areaKm2, minutes } from "@/lib/format";

/**
 * The map.
 *
 * Three things are layered here and they answer three different questions:
 * where the fire has been seen (hotspots), where the model says it is going
 * (probability contours), and what is in the way (assets). They are drawn in
 * that order and styled so they never compete — the fire is a faint field with
 * a bright edge, the assets are hard marks, because the assets are what a
 * coordinator acts on.
 *
 * ARCA's sources and layers are composed into the *initial* style rather than
 * added afterwards. Every event-based trigger for `addLayer` was wrong in a
 * different way: `load` waits for the basemap's sprite and glyphs and never
 * fires when those hang, and `styledata` fires while the style is still
 * loading, so `addSource` throws. Composing up front removes the timing
 * question entirely — the fire renders whether or not the basemap ever does.
 */

/**
 * A raster basemap, not a vector one.
 *
 * The vector style brought a dependency chain that has to complete before
 * MapLibre will expose a single layer: style JSON, sprite sheet, glyph ranges,
 * and worker-side tile parsing. When any link stalls, the map exposes nothing
 * and the fire disappears with the roads — which is the worst possible failure
 * for a screen whose content is the fire.
 *
 * Raster tiles have none of that: one source, one layer, images. They cost
 * sharpness at high zoom and gain a map that is either there or visibly absent.
 */
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas";

// Note the {z}/{y}/{x} order: ArcGIS puts row before column, and getting it the
// usual way round silently serves tiles from the wrong place.
const BASEMAP_TILES = (
  process.env.NEXT_PUBLIC_BASEMAP_TILES ??
  `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`
).split(",");

/** Place names, as a separate layer so they can sit above the fire's fill. */
const BASEMAP_LABEL_TILES = `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`;

const BASEMAP_ATTRIBUTION =
  'Esri, HERE, Garmin, © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const GROUND = "#0f0d0c";

export interface IncidentMapProps {
  centre: [number, number];
  hotspots: HotspotView[];
  spread: SpreadView | null;
  sites: RankedSite[];
  /** Null shows the whole horizon; a number shows up to that hour. */
  hour: number | null;
  selectedSiteId: string | null;
  onSelectSite: (assetId: string | null) => void;
  showMasked: boolean;
  showAssets: boolean;
}

export function IncidentMap(props: IncidentMapProps) {
  const [basemapOk, setBasemapOk] = useState<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const readyRef = useRef(false);
  const centredRef = useRef<string | null>(null);

  const onSelectRef = useRef(props.onSelectSite);
  onSelectRef.current = props.onSelectSite;

  // --- sources -------------------------------------------------------------

  const spreadGeoJson = useMemo(() => framesToGeoJson(props.spread?.frames ?? null), [props.spread]);

  const hotspotGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: props.hotspots.map((hotspot) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: hotspot.position },
        properties: {
          id: hotspot.id,
          usable: hotspot.usable ? 1 : 0,
          frp: hotspot.fireRadiativePowerMw ?? 0,
          source: hotspot.source,
          confidence: hotspot.confidence,
          observedAt: hotspot.observedAt,
          reason: hotspot.reason ?? "",
          masked: hotspot.flags.includes("static_source") ? 1 : 0,
        },
      })),
    }),
    [props.hotspots],
  );

  const siteGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: props.sites
        .filter((site) => site.position)
        .map((site) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: site.position as [number, number] },
          properties: {
            id: site.assetId,
            name: site.name,
            action: site.action,
            colour: ACTION_STYLE[site.action].colour,
            rank: site.rank,
            people: site.peopleEstimate,
            spare: site.spareMinutes ?? 99_999,
            arrival: site.arrivalMinutes ?? -1,
            evac: site.evac.minutes,
            subcategory: site.subcategory,
            basis: site.evac.basis,
            runs: `${site.reach.runsReaching}/${site.reach.runsTotal}`,
            // Ranked sites draw above watch-list ones, and the most urgent
            // above everything: overlapping marks must not hide the top row.
            weight: site.rank > 0 ? 1000 - site.rank : 0,
          },
        })),
    }),
    [props.sites],
  );

  const dataRef = useRef({
    spread: spreadGeoJson,
    hotspots: hotspotGeoJson,
    sites: siteGeoJson,
  });
  dataRef.current = { spread: spreadGeoJson, hotspots: hotspotGeoJson, sites: siteGeoJson };

  const hourRef = useRef<number | null>(props.hour);
  hourRef.current = props.hour;

  // --- map lifecycle -------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

    const boot = async () => {
      /**
       * ARCA's own layers go into a minimal style that is guaranteed to load,
       * and the basemap is added underneath them afterwards.
       *
       * The obvious order — basemap first, ARCA's layers on top — fails badly
       * when the basemap is slow: MapLibre exposes no sources or layers until
       * the *whole* style has loaded, including its sprite and glyphs, so a
       * basemap that never settles takes the fire down with it and leaves a
       * blank rectangle. A raster basemap has no such chain, so it is composed
       * in directly and simply appears when its tiles arrive.
       */
      const style = composeStyle(dataRef.current);

      const map = new MapLibreMap({
        container,
        style,
        center: props.centre,
        zoom: 10.5,
        attributionControl: { compact: true },
        dragRotate: false,
      });
      mapRef.current = map;
      readyRef.current = true;

      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

      // Errors are logged, never acted on. A missing tile is routine, and an
      // earlier version that reacted to them tore down a working basemap.
      map.on("error", (event) => {
        const detail = event as unknown as { error?: { message?: string }; sourceId?: string };
        const message = String(detail.error?.message ?? event);
        console.warn("ARCA map:", message);
        // A basemap that cannot load is worth saying out loud, because a dark
        // empty ground and a dark rural map look identical at a glance.
        if (detail.sourceId === "basemap" && !cancelled) setBasemapOk(false);
      });

      // Tiles arriving is the only confirmation that matters.
      map.on("sourcedata", (event) => {
        const detail = event as unknown as { sourceId?: string; isSourceLoaded?: boolean };
        if (detail.sourceId === "basemap" && detail.isSourceLoaded && !cancelled) {
          setBasemapOk(true);
        }
      });

      applyHourFilter(map, hourRef.current);


      const hover = (layer: string, build: (properties: Record<string, unknown>) => string) => {
        map.on("mouseenter", layer, (event: MapLayerMouseEvent) => {
          map.getCanvas().style.cursor = "pointer";
          const feature = event.features?.[0];
          if (!feature) return;
          popupRef.current?.remove();
          popupRef.current = new Popup({ closeButton: false, offset: 12, maxWidth: "280px" })
            .setLngLat(event.lngLat)
            .setHTML(build(feature.properties as Record<string, unknown>))
            .addTo(map);
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
          popupRef.current?.remove();
          popupRef.current = null;
        });
      };

      hover("sites-point", siteTooltip);
      hover("hotspots-live", hotspotTooltip);
      hover("hotspots-masked", hotspotTooltip);

      map.on("click", "sites-point", (event: MapLayerMouseEvent) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current(id);
      });
      map.on("click", (event: MapMouseEvent) => {
        const hits = map.queryRenderedFeatures(event.point, { layers: ["sites-point"] });
        if (hits.length === 0) onSelectRef.current(null);
      });

      // A read-only handle for inspecting layers from a browser console.
      (window as unknown as { __arcaMap?: MapLibreMap }).__arcaMap = map;
    };

    void boot();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
      centredRef.current = null;
    };
    // Created once; the effects below keep it current. Re-creating it on every
    // prop change would throw away tiles and flash the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- data, filter, visibility, framing ------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    setData(map, "spread", spreadGeoJson);
    setData(map, "hotspots", hotspotGeoJson);
    setData(map, "sites", siteGeoJson);
  }, [spreadGeoJson, hotspotGeoJson, siteGeoJson, basemapOk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyHourFilter(map, props.hour);
  }, [props.hour, spreadGeoJson, basemapOk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    setVisible(map, ["hotspots-masked"], props.showMasked);
    setVisible(map, ["sites-halo", "sites-collar", "sites-point", "sites-label"], props.showAssets);
  }, [props.showMasked, props.showAssets, basemapOk]);

  // Fit once per incident. Re-fitting on every update would fight a coordinator
  // who has panned somewhere deliberately.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const key = `${props.centre[0].toFixed(3)},${props.centre[1].toFixed(3)}`;
    if (centredRef.current === key) return;

    const bounds = new LngLatBounds();
    let count = 0;
    for (const feature of siteGeoJson.features) {
      bounds.extend((feature.geometry as GeoJSON.Point).coordinates as [number, number]);
      count++;
    }
    for (const hotspot of props.hotspots.slice(0, 500)) {
      bounds.extend(hotspot.position);
      count++;
    }
    if (count > 1) map.fitBounds(bounds, { padding: 90, maxZoom: 13, duration: 700 });
    else map.flyTo({ center: props.centre, zoom: 11, duration: 700 });
    centredRef.current = key;
  }, [props.centre, siteGeoJson, props.hotspots, basemapOk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !props.selectedSiteId) return;
    const site = props.sites.find((candidate) => candidate.assetId === props.selectedSiteId);
    if (site?.position) {
      map.easeTo({ center: site.position, zoom: Math.max(map.getZoom(), 12), duration: 600 });
    }
  }, [props.selectedSiteId, props.sites]);

  return (
    <div className="relative h-full w-full" style={{ background: GROUND }}>
      <div ref={containerRef} className="h-full w-full" />
      {basemapOk === false ? (
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-3 panel bg-[var(--color-surface)]/92 px-3 py-1.5">
          <p className="text-[10px] text-[var(--color-warn)]">
            Basemap unavailable — the fire and the sites are still live.
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style composition
// ---------------------------------------------------------------------------

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

/**
 * The basemap's layers with ARCA's on top, or ARCA's alone on a flat ground.
 *
 * Fonts are taken from the basemap when there is one; without it, labels are
 * dropped rather than requesting glyphs from a host that is evidently not
 * answering. Losing labels is a smaller loss than losing the map.
 */
function composeStyle(data: {
  spread: GeoJSON.FeatureCollection;
  hotspots: GeoJSON.FeatureCollection;
  sites: GeoJSON.FeatureCollection;
}): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: BASEMAP_TILES,
        tileSize: 256,
        maxzoom: 16,
        attribution: BASEMAP_ATTRIBUTION,
      },
      basemapLabels: {
        type: "raster",
        tiles: [BASEMAP_LABEL_TILES],
        tileSize: 256,
        maxzoom: 16,
      },
      spread: { type: "geojson", data: data.spread },
      hotspots: { type: "geojson", data: data.hotspots },
      sites: { type: "geojson", data: data.sites },
    },
    layers: [
      { id: "ground", type: "background", paint: { "background-color": GROUND } },
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        // Held back so the fire and the markers stay the brightest things on
        // screen; the map is orientation, not content.
        paint: { "raster-opacity": 0.9, "raster-fade-duration": 200 },
      },
      // No symbol layers: a raster basemap declares no glyphs, so site labels
      // are drawn as part of the site marks instead of as map text.
      ...arcaLayers(false),
      {
        // Place names last, so a town stays readable through the fire's fill.
        // Knowing which village is inside the perimeter is the whole point of
        // having a basemap at all.
        id: "basemap-labels",
        type: "raster",
        source: "basemapLabels",
        paint: { "raster-opacity": 0.75, "raster-fade-duration": 200 },
      },
    ],
  };
}

function arcaLayers(canLabel: boolean): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    // Fire first, as a faint field with a bright edge.
    {
      id: "spread-fill",
      type: "fill",
      source: "spread",
      paint: {
        "fill-color": [
          "interpolate", ["linear"], ["get", "probability"],
          0.2, "#fbbf24", 0.5, "#f97316", 0.8, "#dc2626", 1, "#991b1b",
        ],
        // Very faint, because these contours are nested: five stacked fills at
        // a readable opacity compound into an opaque blob that hides the map
        // underneath. The outline below carries the shape instead.
        "fill-opacity": [
          "interpolate", ["linear"], ["get", "probability"],
          0.2, 0.05, 0.5, 0.09, 1, 0.16,
        ],
      },
    },
    {
      id: "spread-line",
      type: "line",
      source: "spread",
      paint: {
        "line-color": [
          "interpolate", ["linear"], ["get", "probability"],
          0.2, "#fcd34d", 0.5, "#fb923c", 0.8, "#f87171", 1, "#ef4444",
        ],
        // A contour reads as a front; a filled blob reads as a stain.
        "line-width": [
          "interpolate", ["linear"], ["get", "probability"],
          0.2, 1, 0.5, 1.6, 1, 2.4,
        ],
        "line-opacity": ["interpolate", ["linear"], ["get", "probability"], 0.2, 0.5, 1, 0.95],
      },
    },

    // Detections: what a satellite actually saw.
    {
      id: "hotspots-masked",
      type: "circle",
      source: "hotspots",
      filter: ["==", ["get", "masked"], 1],
      paint: {
        "circle-radius": 4,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#6f6762",
        "circle-stroke-width": 1.2,
      },
    },
    {
      id: "hotspots-live",
      type: "circle",
      source: "hotspots",
      filter: ["==", ["get", "masked"], 0],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 2.4, 50, 4, 300, 6.5],
        "circle-color": ["case", ["==", ["get", "usable"], 1], "#fb923c", "#78716c"],
        "circle-opacity": ["case", ["==", ["get", "usable"], 1], 0.9, 0.4],
        "circle-stroke-color": GROUND,
        "circle-stroke-width": 0.5,
      },
    },

    // Assets last, as hard marks: these are the things to act on.
    {
      id: "sites-halo",
      type: "circle",
      source: "sites",
      filter: [
        "any",
        ["==", ["get", "action"], "EVACUATE_NOW"],
        ["==", ["get", "action"], "SHELTER_CANDIDATE"],
      ],
      paint: {
        "circle-radius": 18,
        "circle-color": ["to-color", ["get", "colour"]],
        "circle-opacity": 0.16,
        "circle-blur": 0.6,
      },
    },
    {
      // A dark collar under every marker. Without it a red site on an orange
      // fire is invisible, which is exactly where sites matter most.
      id: "sites-collar",
      type: "circle",
      source: "sites",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          9, ["interpolate", ["linear"], ["get", "weight"], 0, 7, 1000, 10],
          14, ["interpolate", ["linear"], ["get", "weight"], 0, 9, 1000, 14],
        ],
        "circle-color": GROUND,
        "circle-opacity": 0.9,
      },
    },
    {
      id: "sites-point",
      type: "circle",
      source: "sites",
      paint: {
        // to-color is required: MapLibre type-checks paint expressions, and
        // ["get"] yields a string where circle-color demands a colour.
        "circle-color": ["to-color", ["get", "colour"]],
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          9, ["interpolate", ["linear"], ["get", "weight"], 0, 4, 1000, 6],
          14, ["interpolate", ["linear"], ["get", "weight"], 0, 5.5, 1000, 9],
        ],
        "circle-stroke-color": GROUND,
        "circle-stroke-width": 1.5,
      },
    },
  ];

  if (canLabel) {
    layers.push({
      id: "sites-label",
      type: "symbol",
      source: "sites",
      filter: [">", ["get", "weight"], 994],
      layout: {
        "text-field": ["concat", ["to-string", ["get", "rank"]], ". ", ["get", "name"]],
        "text-font": ["Open Sans Regular"],
        "text-size": 11,
        "text-offset": [0, 1.4],
        "text-anchor": "top",
        "text-max-width": 13,
        "text-allow-overlap": false,
        "text-optional": true,
        "text-padding": 4,
      },
      paint: {
        "text-color": "#f5f2ef",
        "text-halo-color": GROUND,
        "text-halo-width": 2,
        "text-halo-blur": 0.4,
      },
    });
  }

  return layers;
}

// ---------------------------------------------------------------------------
// Map operations, each tolerant of a style that is still settling
// ---------------------------------------------------------------------------

function setData(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection): void {
  try {
    (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  } catch {
    // A source not yet materialised will pick the data up from the style it
    // was created with; the next update lands normally.
  }
}

/** Scrubbing an hour is a filter change: a repaint, not a re-upload. */
function applyHourFilter(map: MapLibreMap, hour: number | null): void {
  const filter =
    hour === null
      ? (["all"] as unknown as FilterSpecification)
      : (["<=", ["get", "hour"], hour] as unknown as FilterSpecification);
  for (const layer of ["spread-fill", "spread-line"]) {
    try {
      if (map.getLayer(layer)) map.setFilter(layer, filter);
    } catch {
      /* layer not present yet */
    }
  }
}

function setVisible(map: MapLibreMap, layers: string[], visible: boolean): void {
  for (const layer of layers) {
    try {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", visible ? "visible" : "none");
      }
    } catch {
      /* layer not present yet */
    }
  }
}

/**
 * Flatten per-hour probability contours into one source.
 *
 * Highest probability last so it paints on top of the envelope it sits inside,
 * which is what makes the core read as hotter rather than as a separate shape.
 */
function framesToGeoJson(frames: SpreadFrameView[] | null): GeoJSON.FeatureCollection {
  if (!frames || frames.length === 0) return emptyCollection();
  const features: GeoJSON.Feature[] = [];
  for (const frame of frames) {
    const ordered = [...frame.contours].sort((a, b) => a.probability - b.probability);
    for (const contour of ordered) {
      features.push({
        type: "Feature",
        geometry: contour.geometry,
        properties: {
          hour: frame.hour,
          minutes: frame.minutes,
          probability: contour.probability,
          areaM2: contour.areaM2,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function siteTooltip(properties: Record<string, unknown>): string {
  const action = String(properties.action ?? "MONITOR") as keyof typeof ACTION_STYLE;
  const style = ACTION_STYLE[action] ?? ACTION_STYLE.MONITOR;
  const spare = Number(properties.spare);
  const basis = properties.basis === "reported" ? "reported" : "registered capacity";
  return `
    <div style="min-width:190px">
      <div style="font-weight:600;margin-bottom:2px">${escapeHtml(properties.name)}</div>
      <div style="color:#a8a09a;font-size:11px;margin-bottom:6px">${escapeHtml(
        String(properties.subcategory ?? "").replace(/_/g, " "),
      )}</div>
      <div style="display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;letter-spacing:.04em;background:${
        style.colour
      }22;color:${style.colour};border:1px solid ${style.colour}55">${style.short}</div>
      <div style="margin-top:8px;font-size:11px;line-height:1.55;color:#d6d0cb">
        <div>Fire in <b>${minutes(
          Number(properties.arrival) < 0 ? null : Number(properties.arrival),
        )}</b> · needs <b>${minutes(Number(properties.evac))}</b></div>
        <div>Spare <b style="color:${spare < 0 ? "#e879f9" : "#f5f2ef"}">${
          spare > 90_000 ? "—" : minutes(spare)
        }</b> · ${escapeHtml(properties.runs)} runs reach it</div>
        <div style="color:#a8a09a">${escapeHtml(properties.people)} people (${basis})</div>
      </div>
    </div>`;
}

function hotspotTooltip(properties: Record<string, unknown>): string {
  const masked = Number(properties.masked) === 1;
  const frp = Number(properties.frp);
  return `
    <div style="min-width:180px">
      <div style="font-weight:600">${escapeHtml(properties.source)}</div>
      <div style="color:#a8a09a;font-size:11px;margin-top:2px">
        ${escapeHtml(String(properties.observedAt).slice(11, 16))}Z · ${escapeHtml(
          properties.confidence,
        )}${frp ? ` · ${frp.toFixed(0)} MW` : ""}
      </div>
      ${
        masked
          ? `<div style="margin-top:8px;padding:6px 8px;border-radius:6px;background:#26222055;border:1px solid #433c37;font-size:11px;color:#c9c2bc">
               <b style="color:#a8a09a">Excluded.</b> ${escapeHtml(properties.reason)}
             </div>`
          : ""
      }
    </div>`;
}

export function describeSpread(spread: SpreadView | null, frames: SpreadFrameView[] | null): string {
  if (!spread) return "No model run yet.";
  if (spread.synthetic) {
    return `no usable model output${
      spread.errorMessage ? `: ${spread.errorMessage}` : ""
    } — the footprint is a drawn ring`;
  }
  const last = frames?.[frames.length - 1];
  return `${spread.ensembleMembers ?? 1} ensemble members · footprint ${areaKm2(
    last?.cumulativeAreaM2,
  )}`;
}
