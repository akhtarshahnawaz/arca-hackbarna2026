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
  type MapLayerMouseEvent,
  type MapMouseEvent,
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
 * that order and styled so they never compete — the fire is a soft field, the
 * assets are hard marks, because the assets are what a coordinator acts on.
 *
 * The hour filter is a paint-level filter rather than a source swap, so
 * scrubbing the timeline is a repaint instead of a re-upload. That is the
 * difference between animation that feels like fire spreading and animation
 * that stutters.
 */

const BASEMAP =
  process.env.NEXT_PUBLIC_BASEMAP_URL ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// MapLibre is pinned to v5 deliberately. v6 loads its worker as a separate ES
// module resolved against `import.meta.url`, which neither Turbopack nor
// webpack gives it correctly: the request lands on the app's HTML 404 page, the
// worker never initialises, and the style never reaches `load` — a basemap with
// none of ARCA's layers on it, and no error that points at the cause. v5 inlines
// the worker as a blob and works under any bundler.

/**
 * The map still works with no basemap.
 *
 * If the tile CDN is unreachable — a locked-down network, an outage — the fire,
 * the bands and the assets are the content that matters, and they render
 * perfectly well on an empty ground. This beats a black rectangle that gives a
 * coordinator no reason for what they are seeing.
 */
const FALLBACK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "ground", type: "background", paint: { "background-color": "#12100f" } }],
};

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
  /**
   * What the map is doing, surfaced on screen.
   *
   * A map that fails silently is the worst outcome for a coordinator: an empty
   * dark rectangle looks identical to "no fire near anything". Saying which
   * stage failed turns that into information.
   */
  const [status, setStatus] = useState<"loading" | "ready" | "no-basemap" | "failed">("loading");
  const [detail, setDetail] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const readyRef = useRef(false);
  const centredRef = useRef<string | null>(null);
  const onSelectRef = useRef(props.onSelectSite);
  onSelectRef.current = props.onSelectSite;

  /**
   * The latest data, held in a ref the map pulls from.
   *
   * Pushing data from an effect is not enough on its own: React remounts
   * components in development, so the map is torn down and rebuilt while the
   * data effect's dependencies are unchanged and it never re-runs. The new map
   * then has layers and no data. Letting the map pull on load removes the
   * ordering dependency in both directions.
   */
  const dataRef = useRef<{
    spread: GeoJSON.FeatureCollection;
    hotspots: GeoJSON.FeatureCollection;
    sites: GeoJSON.FeatureCollection;
  }>({ spread: emptyCollection(), hotspots: emptyCollection(), sites: emptyCollection() });

  const filterRef = useRef<number | null>(props.hour);
  filterRef.current = props.hour;

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
          staticSource: hotspot.staticSourceName ?? "",
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

  dataRef.current = { spread: spreadGeoJson, hotspots: hotspotGeoJson, sites: siteGeoJson };

  // --- map lifecycle -------------------------------------------------------

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP,
      center: props.centre,
      zoom: 10.5,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    mapRef.current = map;

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    // Map errors are logged, never acted on. An earlier version swapped the
    // style whenever any error mentioned tiles — and a single missing tile,
    // which is routine, tore down every layer that had already been added.
    map.on("error", (event) => {
      const message = String(
        (event as unknown as { error?: { message?: string } }).error?.message ?? event,
      );
      console.warn("ARCA map:", message);
      setDetail(message.slice(0, 160));
    });

    // One narrow check instead: if the style has not loaded at all after a few
    // seconds, the basemap host is unreachable, so fall back to a flat ground
    // and keep the fire and the assets on screen.
    const styleWatchdog = setTimeout(() => {
      if (!readyRef.current) {
        console.warn("ARCA: basemap did not load. Falling back to a flat ground.");
        setStatus("no-basemap");
        map.setStyle(FALLBACK_STYLE as never);
      }
    }, 6_000);

    /**
     * Add ARCA's layers as soon as the style can accept them.
     *
     * Deliberately not gated on `load`. That event waits for the basemap's
     * sprite and glyph requests to finish, and when those hang — a slow or
     * filtered tile host — it never fires at all, leaving a map with no fire,
     * no assets and no explanation. `styledata` fires as soon as the style
     * itself is usable, so ARCA's own layers appear even when the basemap's
     * decorations never arrive.
     */
    const setupLayers = () => {
      if (readyRef.current || map.getSource("spread")) return;
      try {
        map.addSource("spread", { type: "geojson", data: emptyCollection() });
        map.addSource("hotspots", { type: "geojson", data: emptyCollection() });
        map.addSource("sites", { type: "geojson", data: emptyCollection() });

        // Fire first, as a soft field.
        map.addLayer({
          id: "spread-fill",
          type: "fill",
          source: "spread",
          paint: {
            "fill-color": [
              "interpolate", ["linear"], ["get", "probability"],
              0.2, "#fef08a", 0.4, "#fbbf24", 0.6, "#f97316", 0.8, "#dc2626", 1, "#7f1d1d",
            ],
            // Low-probability outer contours stay faint so the high-probability
            // core reads as the core rather than as one flat blob.
            // Kept low on purpose. The fire is context; the assets sitting on
            // top of it are what a coordinator acts on, and at the opacity this
            // ramp first used the markers disappeared into the orange.
            "fill-opacity": [
              "interpolate", ["linear"], ["get", "probability"],
              0.2, 0.1, 0.5, 0.18, 1, 0.28,
            ],
          },
        });
        map.addLayer({
          id: "spread-line",
          type: "line",
          source: "spread",
          paint: {
            "line-color": [
              "interpolate", ["linear"], ["get", "probability"],
              0.2, "#fbbf24", 0.6, "#f97316", 1, "#ef4444",
            ],
            "line-width": ["interpolate", ["linear"], ["get", "probability"], 0.2, 0.6, 1, 1.6],
            "line-opacity": 0.75,
          },
        });

        // Detections: what a satellite actually saw.
        map.addLayer({
          id: "hotspots-masked",
          type: "circle",
          source: "hotspots",
          filter: ["==", ["get", "masked"], 1],
          paint: {
            "circle-radius": 4,
            "circle-color": "transparent",
            "circle-stroke-color": "#6f6762",
            "circle-stroke-width": 1.2,
            "circle-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "hotspots-live",
          type: "circle",
          source: "hotspots",
          filter: ["==", ["get", "masked"], 0],
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["get", "frp"],
              0, 2.6, 50, 4.5, 300, 7,
            ],
            "circle-color": ["case", ["==", ["get", "usable"], 1], "#fb923c", "#78716c"],
            "circle-opacity": ["case", ["==", ["get", "usable"], 1], 0.85, 0.4],
            "circle-stroke-color": "#0a0908",
            "circle-stroke-width": 0.5,
          },
        });

        // Assets last, as hard marks: these are the things to act on.
        map.addLayer({
          id: "sites-halo",
          type: "circle",
          source: "sites",
          filter: ["any", ["==", ["get", "action"], "EVACUATE_NOW"], ["==", ["get", "action"], "SHELTER_CANDIDATE"]],
          paint: {
            "circle-radius": 16,
            // to-color is required: MapLibre type-checks paint expressions, and
            // ["get"] yields a string where circle-color demands a colour. Without
            // it addLayer throws, which silently aborts the rest of this handler.
            "circle-color": ["to-color", ["get", "colour"]],
            "circle-opacity": 0.14,
            "circle-blur": 0.5,
          },
        });
        // A dark collar under every marker. Without it a red site on an orange
        // fire is invisible, which is exactly where sites matter most.
        map.addLayer({
          id: "sites-collar",
          type: "circle",
          source: "sites",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              9, ["interpolate", ["linear"], ["get", "weight"], 0, 7, 1000, 10],
              14, ["interpolate", ["linear"], ["get", "weight"], 0, 9, 1000, 14],
            ],
            "circle-color": "#0a0908",
            "circle-opacity": 0.85,
          },
        });
        map.addLayer({
          id: "sites-point",
          type: "circle",
          source: "sites",
          paint: {
            "circle-radius": [
              "interpolate", ["linear"], ["zoom"],
              9, ["interpolate", ["linear"], ["get", "weight"], 0, 4, 1000, 6],
              14, ["interpolate", ["linear"], ["get", "weight"], 0, 5.5, 1000, 9],
            ],
            "circle-color": ["to-color", ["get", "colour"]],
            "circle-stroke-color": "#0a0908",
            "circle-stroke-width": 1.5,
            "circle-opacity": 1,
          },
        });
        map.addLayer({
          id: "sites-label",
          type: "symbol",
          source: "sites",
          filter: [">", ["get", "weight"], 994],
          layout: {
            "text-field": ["concat", ["to-string", ["get", "rank"]], ". ", ["get", "name"]],
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
            "text-halo-color": "#0a0908",
            "text-halo-width": 2,
            "text-halo-blur": 0.4,
          },
        });

        readyRef.current = true;
        applyData(map, dataRef.current);
        applyHourFilter(map, filterRef.current);
        map.resize();
        setStatus("ready");

        // A handle for inspecting layers and sources from a browser console.
        // Read-only debugging aid on a screen that is already authenticated.
        (window as unknown as { __arcaMap?: MapLibreMap }).__arcaMap = map;
      } catch (error) {
        // The style may not be ready on the first styledata. Remove anything
        // partially added so the next attempt starts from a known state, and
        // only report a failure once retrying stops helping.
        for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
        for (const id of SOURCE_IDS) if (map.getSource(id)) map.removeSource(id);
        setupAttempts += 1;
        if (setupAttempts >= 5) {
          console.error("ARCA: map layer setup failed", error);
          setStatus("failed");
          setDetail(error instanceof Error ? error.message : String(error));
        }
      }
    };

    let setupAttempts = 0;
    map.on("styledata", setupLayers);
    map.on("load", setupLayers);
    if (map.isStyleLoaded()) setupLayers();

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

    return () => {
      clearTimeout(styleWatchdog);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // The map is created once and updated by the effects below; re-creating it
    // on every prop change would throw away tiles and flash the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- data updates --------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (readyRef.current) {
      applyData(map, { spread: spreadGeoJson, hotspots: hotspotGeoJson, sites: siteGeoJson });
    }
    // No else branch: a map that is not ready yet pulls this same data from the
    // ref when its load handler runs.
  }, [spreadGeoJson, hotspotGeoJson, siteGeoJson]);

  // Scrubbing the hour is a filter change, which repaints without re-uploading.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyHourFilter(map, props.hour);
  }, [props.hour, spreadGeoJson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    for (const layer of ["hotspots-masked"]) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", props.showMasked ? "visible" : "none");
      }
    }
    for (const layer of ["sites-point", "sites-label", "sites-halo", "sites-collar"]) {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", props.showAssets ? "visible" : "none");
      }
    }
  }, [props.showMasked, props.showAssets]);

  // Fit once per incident. Re-fitting on every update would fight a coordinator
  // who has panned somewhere deliberately.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${props.centre[0].toFixed(3)},${props.centre[1].toFixed(3)}`;
    if (centredRef.current === key) return;

    const fit = () => {
      const bounds = new LngLatBounds();
      let count = 0;
      for (const feature of siteGeoJson.features) {
        const point = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        bounds.extend(point);
        count++;
      }
      for (const hotspot of props.hotspots.slice(0, 500)) {
        bounds.extend(hotspot.position);
        count++;
      }
      if (count > 1) map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 900 });
      else map.flyTo({ center: props.centre, zoom: 11, duration: 900 });
      centredRef.current = key;
    };

    // Same reason as the layer setup: `load` may never fire if the basemap's
    // sprite or glyph requests hang, and an unfitted map shows a slice of the
    // fire with no indication that there is more of it off screen.
    if (readyRef.current) {
      fit();
    } else {
      const onReady = () => {
        if (!readyRef.current) return;
        map.off("styledata", onReady);
        fit();
      };
      map.on("styledata", onReady);
    }
  }, [props.centre, siteGeoJson, props.hotspots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !props.selectedSiteId) return;
    const site = props.sites.find((candidate) => candidate.assetId === props.selectedSiteId);
    if (site?.position) map.easeTo({ center: site.position, zoom: Math.max(map.getZoom(), 12), duration: 600 });
  }, [props.selectedSiteId, props.sites]);

  // h-full rather than absolute inset-0: MapLibre's own stylesheet sets
  // `position: relative` on the container it is given, which would override an
  // absolute position and collapse the element to zero height.
  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {status !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="panel bg-[var(--color-surface)]/92 px-4 py-3 max-w-[340px] text-center">
            <p className="text-[12px] text-[var(--color-ink-dim)]">
              {status === "loading"
                ? "Loading the map…"
                : status === "no-basemap"
                  ? "Basemap unavailable. Showing the fire and the assets on a flat ground."
                  : "The map failed to initialise."}
            </p>
            {detail ? (
              <p className="mt-1.5 text-[10px] text-[var(--color-ink-faint)] break-words">{detail}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const SOURCE_IDS = ["spread", "hotspots", "sites"] as const;
const LAYER_IDS = [
  "spread-fill",
  "spread-line",
  "hotspots-masked",
  "hotspots-live",
  "sites-halo",
  "sites-collar",
  "sites-point",
  "sites-label",
] as const;

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function applyData(
  map: MapLibreMap,
  data: {
    spread: GeoJSON.FeatureCollection;
    hotspots: GeoJSON.FeatureCollection;
    sites: GeoJSON.FeatureCollection;
  },
): void {
  (map.getSource("spread") as GeoJSONSource | undefined)?.setData(data.spread);
  (map.getSource("hotspots") as GeoJSONSource | undefined)?.setData(data.hotspots);
  (map.getSource("sites") as GeoJSONSource | undefined)?.setData(data.sites);
}

/** Scrubbing an hour is a filter change: a repaint, not a re-upload. */
function applyHourFilter(map: MapLibreMap, hour: number | null): void {
  const filter =
    hour === null
      ? (["all"] as unknown as FilterSpecification)
      : (["<=", ["get", "hour"], hour] as unknown as FilterSpecification);
  for (const layer of ["spread-fill", "spread-line"]) {
    if (map.getLayer(layer)) map.setFilter(layer, filter);
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
        <div>Arrival <b>${minutes(Number(properties.arrival) < 0 ? null : Number(properties.arrival))}</b> · needs <b>${minutes(
          Number(properties.evac),
        )}</b></div>
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

export function spreadLegendEntries(spread: SpreadView | null): Array<{ label: string; colour: string }> {
  if (spread?.synthetic) {
    return [{ label: "Drawn ring, not a model prediction", colour: "#78716c" }];
  }
  return [
    { label: "2 in 10 runs", colour: "#fef08a" },
    { label: "4 in 10", colour: "#fbbf24" },
    { label: "6 in 10", colour: "#f97316" },
    { label: "8 in 10", colour: "#dc2626" },
    { label: "Every run", colour: "#7f1d1d" },
  ];
}

export function describeSpread(spread: SpreadView | null, frames: SpreadFrameView[] | null): string {
  if (!spread) return "No model run yet.";
  if (spread.synthetic) {
    return `No usable model output${spread.errorMessage ? `: ${spread.errorMessage}` : ""}. The footprint is a drawn ring.`;
  }
  const last = frames?.[frames.length - 1];
  return `${spread.ensembleMembers ?? 1} ensemble members · footprint ${areaKm2(last?.cumulativeAreaM2)} · expected burn ${areaKm2(
    last?.expectedAreaM2,
  )}`;
}
