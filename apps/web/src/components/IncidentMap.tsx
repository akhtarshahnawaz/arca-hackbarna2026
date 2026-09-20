"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSONSource,
  LngLatBounds,
  MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  type DataDrivenPropertyValueSpecification,
  type FilterSpecification,
  type LayerSpecification,
  type MapLayerMouseEvent,
  type MapMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RankedSite } from "@arca/core";
import type { HotspotView, SpreadFrameView, SpreadView } from "@/lib/api";
import { iconImageId, iconKeyFor, registerSiteIcons } from "./siteIcons";
import { ACTION_STYLE, areaKm2, euros, minutes } from "@/lib/format";

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
  /** The click-opened record, kept apart from the transient hover card. */
  const detailRef = useRef<Popup | null>(null);
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

  /**
   * Footprints, where the registry has one.
   *
   * A school is a building, not a dot. Kept in its own source from the markers
   * so the outline can sit under the fire while the mark sits on top of it —
   * the shape is context, the mark is the thing you click.
   */
  const siteShapeGeoJson = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: props.sites
        .filter(
          (site) =>
            site.geometry &&
            (site.geometry.type === "Polygon" || site.geometry.type === "MultiPolygon"),
        )
        .map((site) => ({
          type: "Feature",
          geometry: site.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
          properties: {
            id: site.assetId,
            colour: ACTION_STYLE[site.action].colour,
            ranked: site.rank > 0 ? 1 : 0,
          },
        })),
    }),
    [props.sites],
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
            // The disc says what to do; this says what the place is.
            icon: iconImageId(
              iconKeyFor({
                category: site.category,
                subcategory: site.subcategory,
                responseAsset: site.responseAsset,
              }),
            ),
            runs: `${site.reach.runsReaching}/${site.reach.runsTotal}`,
            livestock: site.livestockUnits ?? 0,
            value: site.valueEur ?? 0,
            phone: site.contacts?.phone?.[0] ?? "",
            operator: site.contacts?.operator ?? "",
            hazardous: site.hazardous ? 1 : 0,
            responder: site.responseAsset ? 1 : 0,
            reason: site.explanation.actionReason,
            sources: site.provenance.map((entry) => entry.source_id).join(", "),
            assumptions: site.evac.assumptions.join("; "),
            animalMinutes: site.evac.livestockMinutes,
            status: site.status,
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
    "site-shapes": siteShapeGeoJson,
  });
  dataRef.current = {
    spread: spreadGeoJson,
    hotspots: hotspotGeoJson,
    sites: siteGeoJson,
    "site-shapes": siteShapeGeoJson,
  };

  const hourRef = useRef<number | null>(props.hour);
  hourRef.current = props.hour;

  /** The last frame, which is what "whole horizon" means on the map. */
  const maxHour = useMemo(
    () => (props.spread?.frames ?? []).reduce((max, frame) => Math.max(max, frame.hour), 0),
    [props.spread],
  );
  const maxHourRef = useRef(maxHour);
  maxHourRef.current = maxHour;

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

      // Glyphs must exist before the symbol layer that references them, or
      // MapLibre logs a missing-image warning for every feature on screen.
      registerSiteIcons(map);

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

      applyHourFilter(map, hourRef.current, maxHourRef.current);


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

      /**
       * Clicking a site opens the full record, and keeps it open.
       *
       * The hover card is a glance — name, action, spare time. This is the
       * answer to "what actually is this and who do I ring", which is a
       * different question and one you ask while looking away at a phone. It
       * has a close button and does not vanish when the mouse moves, because a
       * panel that disappears while you are reading a number off it is worse
       * than no panel.
       */
      map.on("click", "sites-point", (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id;
        if (typeof id !== "string") return;
        onSelectRef.current(id);

        popupRef.current?.remove();
        detailRef.current?.remove();
        detailRef.current = new Popup({
          closeButton: true,
          closeOnClick: false,
          offset: 14,
          maxWidth: "320px",
          className: "arca-detail",
        })
          .setLngLat(event.lngLat)
          .setHTML(siteDetailCard(feature!.properties as Record<string, unknown>))
          .addTo(map);
        detailRef.current.on("close", () => {
          detailRef.current = null;
        });
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
      detailRef.current?.remove();
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
    setData(map, "site-shapes", siteShapeGeoJson);
  }, [spreadGeoJson, hotspotGeoJson, siteGeoJson, siteShapeGeoJson, basemapOk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyHourFilter(map, props.hour, maxHour);
  }, [props.hour, maxHour, spreadGeoJson, basemapOk]);

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

  /**
   * Show which site is selected, wherever the selection came from.
   *
   * Picking a row in the list and then hunting the map for which dot it was is
   * the kind of small friction that makes people stop using the list.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    try {
      if (map.getLayer("sites-selected")) {
        map.setFilter("sites-selected", [
          "==",
          ["get", "id"],
          props.selectedSiteId ?? "__none__",
        ] as unknown as FilterSpecification);
      }
    } catch {
      /* layer not attached yet; the next data update reapplies it */
    }
    if (!props.selectedSiteId) detailRef.current?.remove();
  }, [props.selectedSiteId, siteGeoJson, basemapOk]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !props.selectedSiteId) return;
    const site = props.sites.find((candidate) => candidate.assetId === props.selectedSiteId);
    if (!site?.position) return;

    // Only move the map when the site is not already on it. Recentring a map
    // the operator is already reading, because they clicked a row for the
    // site in the middle of it, is disorienting for no gain.
    if (map.getBounds().contains(site.position) && map.getZoom() >= 11.5) return;
    map.easeTo({ center: site.position, zoom: Math.max(map.getZoom(), 13), duration: 600 });
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
  "site-shapes": GeoJSON.FeatureCollection;
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
      "site-shapes": { type: "geojson", data: data["site-shapes"] },
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

/**
 * Burn probability to colour, in DeepFire's own ramp.
 *
 * Shared by the fill and the feather so a boundary is over-drawn in exactly the
 * colour it already had; any difference would show up as a halo.
 */
const FIRE_RAMP = [
  "interpolate", ["linear"], ["get", "probability"],
  0.2, "#fde68a",
  0.4, "#fbbf24",
  0.6, "#f97316",
  0.8, "#dc2626",
  1, "#7f1d1d",
] as unknown as DataDrivenPropertyValueSpecification<string>;

function arcaLayers(canLabel: boolean): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    /**
     * The fire, as one surface rather than a stack of rings.
     *
     * Only ever one hour is on screen — see `applyHourFilter` — and that hour's
     * contours nest, so five translucent fills composite outward-in into a
     * gradient: pale amber at the edge where two runs in ten reach, deep red in
     * the core where nine do. Each fill is weak enough on its own to keep the
     * towns underneath readable, and the accumulation does the work.
     *
     * An earlier version drew every hour at once. Six hours by five levels is
     * thirty rings, and by the end of the horizon the map was a dartboard.
     */
    {
      id: "spread-fill",
      type: "fill",
      source: "spread",
      paint: {
        "fill-color": FIRE_RAMP,
        // Weak on its own; five nested contours composite outward-in into the
        // falloff. Any stronger and the villages underneath stop being legible,
        // which is the one thing this map may not do.
        "fill-opacity": [
          "interpolate", ["linear"], ["get", "probability"],
          0.2, 0.1, 0.5, 0.14, 0.8, 0.18, 1, 0.22,
        ],
        "fill-antialias": true,
      },
    },
    {
      /**
       * The join between one contour and the next, blurred away.
       *
       * Five stacked fills give five visible steps, and a stepped fire reads as
       * five separate fires. MapLibre cannot blur a fill, so each contour's
       * boundary is over-drawn with a wide, heavily blurred line in its own
       * colour: the steps feather into each other and what is left is a
       * gradient. Purely cosmetic — it sits exactly on a boundary the fill
       * already drew, so it adds no area and claims nothing new.
       */
      id: "spread-feather",
      type: "line",
      source: "spread",
      paint: {
        "line-color": FIRE_RAMP,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 16, 11, 30, 14, 52],
        "line-opacity": 0.1,
        "line-blur": ["interpolate", ["linear"], ["zoom"], 8, 16, 11, 30, 14, 52],
      },
    },
    {
      /**
       * One line, on the outermost contour only.
       *
       * "How far it might get" is a single question with a single answer, and
       * an edge drawn on every level turns the gradient back into rings.
       */
      id: "spread-edge",
      type: "line",
      source: "spread",
      filter: ["==", ["get", "outer"], 1],
      paint: {
        "line-color": "#fde68a",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 13, 1.6],
        "line-opacity": 0.55,
        "line-blur": 0.6,
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

    /**
     * The footprint of a site that has one, under the marker.
     *
     * A school is a building. Drawn as a tinted shape with a crisp edge rather
     * than a heavy outline, so it reads as the extent of the thing without
     * competing with the fire it sits inside.
     */
    {
      id: "site-shape-fill",
      type: "fill",
      source: "site-shapes",
      minzoom: 11,
      paint: {
        "fill-color": ["to-color", ["get", "colour"]],
        "fill-opacity": ["case", ["==", ["get", "ranked"], 1], 0.16, 0.08],
      },
    },
    {
      id: "site-shape-line",
      type: "line",
      source: "site-shapes",
      minzoom: 11,
      paint: {
        "line-color": ["to-color", ["get", "colour"]],
        "line-width": 1.2,
        "line-opacity": 0.7,
      },
    },

    // Assets last, as marks: these are the things to act on.
    {
      /**
       * A soft wash of the action colour under the urgent ones.
       *
       * Replaces a hard dark collar. The collar existed so a red mark stayed
       * visible on an orange fire, and it worked — at the cost of every site
       * looking like it had been stamped on the map with a hole punch. A glow
       * in the mark's own colour separates it from the fire just as well and
       * reads as emphasis rather than as a border.
       */
      id: "sites-halo",
      type: "circle",
      source: "sites",
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, ["interpolate", ["linear"], ["get", "weight"], 0, 0, 960, 9, 1000, 15],
          14, ["interpolate", ["linear"], ["get", "weight"], 0, 13, 1000, 22],
        ],
        "circle-color": ["to-color", ["get", "colour"]],
        "circle-opacity": [
          "case",
          ["any",
            ["==", ["get", "action"], "EVACUATE_NOW"],
            ["==", ["get", "action"], "SHELTER_CANDIDATE"],
          ],
          0.2,
          0.1,
        ],
        "circle-blur": 0.85,
      },
    },
    {
      /**
       * The selection ring.
       *
       * Drawn only around the site the operator picked, in the list or on the
       * map. Picking a row and then hunting the map for which dot moved is the
       * kind of small friction that makes people stop using the list.
       */
      id: "sites-selected",
      type: "circle",
      source: "sites",
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"], 9, 13, 14, 19,
        ],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#f5f2ef",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.9,
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
        /**
         * Rank decides who is on screen at all, until you zoom in.
         *
         * A live Talaia query over a large footprint returns thousands of
         * assets — 3,482 on one Bages run — and every one of them drawn at
         * once is a field of confetti with a map somewhere underneath. A
         * radius of zero is not a hidden marker: MapLibre will not hit-test
         * it either, so clicks pass through to whatever is behind.
         *
         * At the top of the horizon you see the forty that matter. Zoom past
         * 12 and the rest fade in, by which point there is room for them.
         */
        "circle-radius": [
          "interpolate", ["linear"], ["zoom"],
          10, ["interpolate", ["linear"], ["get", "weight"], 0, 0, 959, 0, 960, 4.5, 1000, 7],
          12.5, ["interpolate", ["linear"], ["get", "weight"], 0, 3.2, 1000, 9],
          15, ["interpolate", ["linear"], ["get", "weight"], 0, 6, 1000, 11],
        ],
        // A thin rim of the page background, not a collar: enough to lift the
        // mark off the fire, not enough to read as a ring.
        "circle-stroke-color": GROUND,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.55,
      },
    },
    {
      /**
       * What kind of place it is.
       *
       * Colour is already spoken for — it carries the instruction — so the kind
       * is carried by shape. `icon-allow-overlap` is deliberate: a hospital
       * that vanishes because a campsite is nearby is worse than two marks
       * touching.
       */
      id: "sites-icon",
      type: "symbol",
      source: "sites",
      minzoom: 11.5,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          11.5, ["interpolate", ["linear"], ["get", "weight"], 0, 0, 960, 0.48, 1000, 0.58],
          13, ["interpolate", ["linear"], ["get", "weight"], 0, 0.46, 1000, 0.7],
          15, ["interpolate", ["linear"], ["get", "weight"], 0, 0.6, 1000, 0.82],
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
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
/**
 * Show exactly one hour.
 *
 * Every frame is a complete picture of the fire at that moment — the contours
 * are unioned forward in `spreadFrames` — so one hour is the whole footprint at
 * that hour, not a slice of it. With no hour selected the last frame is shown,
 * which is the full horizon.
 *
 * The previous `<=` filter drew every hour up to the selection on top of each
 * other, which is where the crowding came from.
 */
function applyHourFilter(map: MapLibreMap, hour: number | null, maxHour: number): void {
  const wanted = hour ?? maxHour;
  const filter = ["==", ["get", "hour"], wanted] as unknown as FilterSpecification;
  for (const layer of ["spread-fill", "spread-feather", "spread-edge"]) {
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
    // Lowest probability first, so the widest contour is painted first and the
    // hotter cores land on top of it.
    const ordered = [...frame.contours].sort((a, b) => a.probability - b.probability);
    for (const [index, contour] of ordered.entries()) {
      features.push({
        type: "Feature",
        geometry: contour.geometry,
        properties: {
          hour: frame.hour,
          minutes: frame.minutes,
          probability: contour.probability,
          areaM2: contour.areaM2,
          // Only the widest contour gets an outline: that is the one line
          // anyone reads off this map — how far it might get.
          outer: index === 0 ? 1 : 0,
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

/**
 * Everything known about one site, on click.
 *
 * Deliberately a different thing from the hover card. Hover answers "what am I
 * looking at" in a glance; this answers "what is it, who is inside, what is it
 * worth, and who do I ring", which is read while reaching for a phone. So it
 * closes on a button rather than on mouse-out, and it says where each figure
 * came from — a capacity from a registry and a class default are different
 * claims and the row must not flatten them.
 */
function siteDetailCard(p: Record<string, unknown>): string {
  const action = String(p.action ?? "MONITOR") as keyof typeof ACTION_STYLE;
  const style = ACTION_STYLE[action] ?? ACTION_STYLE.MONITOR;
  const spare = Number(p.spare);
  const arrival = Number(p.arrival);
  const value = Number(p.value) || 0;
  const livestock = Number(p.livestock) || 0;
  const phone = String(p.phone ?? "");
  const basis =
    p.basis === "reported"
      ? "reported by phone"
      : p.basis === "registered"
        ? "registered capacity"
        : "estimated for this kind of site";

  const row = (label: string, value: string) => `
    <div style="display:flex;gap:10px;justify-content:space-between;padding:3px 0">
      <span style="color:#8d8680">${escapeHtml(label)}</span>
      <span style="color:#e9e4e0;text-align:right">${value}</span>
    </div>`;

  const flags = [
    Number(p.hazardous) === 1
      ? `<span style="color:#e7e5e4;border:1px solid #55504c;border-radius:4px;padding:1px 5px;font-size:9px;letter-spacing:.05em">HAZARDOUS</span>`
      : "",
    Number(p.responder) === 1
      ? `<span style="color:#2dd4bf;border:1px solid #2dd4bf55;border-radius:4px;padding:1px 5px;font-size:9px;letter-spacing:.05em">RESPONSE ASSET</span>`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `
    <div style="min-width:264px;font-size:11px;line-height:1.5">
      <div style="font-weight:600;font-size:13.5px;color:#f5f2ef;padding-right:16px">${escapeHtml(p.name)}</div>
      <div style="color:#8d8680;margin-top:1px">${escapeHtml(
        String(p.subcategory ?? "").replace(/_/g, " "),
      )}${p.operator ? ` · ${escapeHtml(p.operator)}` : ""}</div>

      <div style="margin-top:7px;display:flex;gap:5px;align-items:center;flex-wrap:wrap">
        <span style="padding:1.5px 6px;border-radius:4px;font-size:9.5px;letter-spacing:.05em;background:${
          style.colour
        }22;color:${style.colour};border:1px solid ${style.colour}55">${style.short}</span>
        ${flags}
      </div>

      <p style="margin:8px 0 0;color:#b8b2ad">${escapeHtml(p.reason)}</p>

      <div style="margin-top:9px;padding-top:7px;border-top:1px solid #2e2926">
        ${row("People", `<b>${escapeHtml(p.people)}</b> <span style="color:#8d8680;font-size:10px">${escapeHtml(basis)}</span>`)}
        ${livestock > 0 ? row("Animals", `<b>${livestock.toLocaleString("en-GB")}</b> <span style="color:#8d8680;font-size:10px">${minutes(Number(p.animalMinutes))} to move</span>`) : ""}
        ${row("Fire arrives", `<b>${minutes(arrival < 0 ? null : arrival)}</b> <span style="color:#8d8680;font-size:10px">${escapeHtml(p.runs)} runs</span>`)}
        ${row("Moving them takes", `<b>${minutes(Number(p.evac))}</b>`)}
        ${row(
          "Spare time",
          `<b style="color:${spare < 0 ? style.colour : "#f5f2ef"}">${spare > 90_000 ? "—" : minutes(spare)}</b>`,
        )}
        ${value > 0 ? row("Replacement", `<b>${euros(value)}</b> <span style="color:#8d8680;font-size:10px">triage estimate</span>`) : ""}
      </div>

      ${
        phone
          ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid #2e2926">
              ${row("Phone", `<a href="tel:${escapeHtml(phone)}" style="color:#7dd3fc;text-decoration:none">${escapeHtml(phone)}</a>`)}
            </div>`
          : `<div style="margin-top:8px;padding-top:7px;border-top:1px solid #2e2926;color:#8d8680">No number on file. An approved call opens a browser voice session.</div>`
      }

      ${
        p.sources
          ? `<div style="margin-top:8px;color:#6f6762;font-size:9.5px">Sources: ${escapeHtml(p.sources)}</div>`
          : ""
      }
      <div style="margin-top:3px;color:#6f6762;font-size:9.5px">Assumes ${escapeHtml(p.assumptions)}.</div>
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
