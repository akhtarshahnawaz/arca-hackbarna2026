"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { CommandState, RankedSite } from "@/lib/types";
import "leaflet/dist/leaflet.css";

type Props = {
  state: CommandState;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Flies on a selection change only. The console preselects rank 1, so flying on
 * mount would throw away the overview fit and hide the shelters again. The ref
 * seeds from the mount-time selection rather than from a "first run" flag,
 * because StrictMode invokes the effect twice and a flag survives only one pass.
 */
function FlyToSite({ site }: { site: RankedSite | undefined }) {
  const map = useMap();
  const flownId = useRef<string | null>(site?.id ?? null);

  useEffect(() => {
    if (!site || site.id === flownId.current) return;
    flownId.current = site.id;
    map.flyTo([site.lat, site.lon], 12, { duration: 0.6 });
  }, [map, site]);

  return null;
}

/**
 * Fits every plotted feature once, after mount. The map panel sizes after the
 * container mounts, so Leaflet's cached size is stale on the first frame and a
 * `bounds` prop on MapContainer lands markers on the container edge, where the
 * SVG renderer culls them.
 */
function FitFeatures({ bounds }: { bounds: LatLngBoundsExpression | undefined }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || !bounds) return;
    fitted.current = true;
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [40, 40], animate: false });
  }, [map, bounds]);

  return null;
}

/**
 * The tile layer stays mounted across basemap switches so Leaflet keeps its tile
 * cache and swaps the URL in place. Leaflet only reads `attribution` when the
 * layer is created, so the credit is driven through the attribution control
 * instead of through a remount.
 */
function BasemapAttribution({ text }: { text: string }) {
  const map = useMap();

  useEffect(() => {
    const control = map.attributionControl;
    if (!control) return;
    control.addAttribution(text);
    return () => {
      control.removeAttribution(text);
    };
  }, [map, text]);

  return null;
}

const BASEMAPS = {
  map: {
    label: "Map",
    attribution: "Tiles &copy; Esri &mdash; OpenStreetMap",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  },
  satellite: {
    label: "Satellite",
    attribution: "Imagery &copy; Esri &mdash; Maxar, Earthstar Geographics",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
} as const;

type BasemapKey = keyof typeof BASEMAPS;

/**
 * Every marker colour is basemap-specific. The light canvas is near-white, the
 * Esri imagery is dark forest and burned brown, so a palette tuned for one is
 * close to invisible on the other.
 */
const PALETTES = {
  map: {
    ringAlphaBase: 0.08,
    ringAlphaStep: 0.045,
    ringFill: "156, 72, 32",
    ringStroke: "rgba(124, 58, 28, 0.45)",
    hotspotStroke: "#7c3a1c",
    hotspotFill: "#b4532a",
    hotspotWeight: 1,
    shelterStroke: "#3f6212",
    shelterFill: "#84cc16",
    siteStroke: { active: "#1c1917", watch: "#78716c", normal: "#44403c" },
    siteFill: { active: "#1c1917", watch: "#e7e5e4", normal: "#fafaf9" },
  },
  satellite: {
    // Imagery texture swallows low alpha, so the hour-0 ring starts far higher
    // than it does on the flat canvas.
    ringAlphaBase: 0.22,
    ringAlphaStep: 0.055,
    ringFill: "255, 138, 76",
    ringStroke: "rgba(255, 176, 120, 0.75)",
    hotspotStroke: "#fee2e2",
    hotspotFill: "#dc2626",
    hotspotWeight: 1.5,
    shelterStroke: "#1a2e05",
    shelterFill: "#bef264",
    // Brightest marker is the selected one, so emphasis does not invert when a
    // coordinator clicks a site.
    siteStroke: { active: "#0c0a09", watch: "#0c0a09", normal: "#0c0a09" },
    siteFill: { active: "#ffffff", watch: "#78716c", normal: "#a8a29e" },
  },
} as const;

type Palette = (typeof PALETTES)[BasemapKey];

function hourFill(hour: number, palette: Palette) {
  const alpha = palette.ringAlphaBase + hour * palette.ringAlphaStep;
  return `rgba(${palette.ringFill}, ${alpha})`;
}

const FALLBACK_CENTER: LatLngTuple = [41.74, 1.85];

/**
 * The configured shelters sit 30-45 km south-west of the fire, so a fixed
 * fire-centred view never showed them. Fit the operational set instead: sites,
 * shelters, and the displayed ensemble member.
 *
 * Hotspots are deliberately excluded. The Deepfire feed covers the whole
 * Catalonia box (roughly 240 km across), so including them frames the region
 * rather than the incident and leaves the rings a few pixels wide.
 */
function featureBounds(state: CommandState): LatLngBoundsExpression | undefined {
  const points: LatLngTuple[] = [
    ...state.sites.map((site): LatLngTuple => [site.lat, site.lon]),
    ...(state.watch ?? []).map((site): LatLngTuple => [site.lat, site.lon]),
    ...state.shelters.map((shelter): LatLngTuple => [shelter.lat, shelter.lon]),
    ...state.fire.polygons
      .filter((polygon) => polygon.member === state.fire.displayMember)
      .flatMap((polygon) => polygon.ring.map(([lon, lat]): LatLngTuple => [lat, lon])),
  ];
  if (points.length < 2) return undefined;

  let minLat = points[0][0];
  let maxLat = points[0][0];
  let minLon = points[0][1];
  let maxLon = points[0][1];
  for (const [lat, lon] of points) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
  }
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

export function CommandMap({ state, selectedId, onSelect }: Props) {
  const allSites = [...state.sites, ...(state.watch ?? [])];
  const selected = allSites.find((site) => site.id === selectedId);
  const rings = state.fire.polygons.filter((polygon) => polygon.member === state.fire.displayMember);
  const [basemap, setBasemap] = useState<BasemapKey>("map");
  const palette = PALETTES[basemap];
  const bounds = useMemo(() => featureBounds(state), [state]);

  return (
    <div className="relative size-full" data-basemap={basemap}>
      <MapContainer
        center={FALLBACK_CENTER}
        zoom={11}
        className="arca-map size-full"
        zoomControl={false}
        attributionControl
        scrollWheelZoom
      >
        <FitFeatures bounds={bounds} />
        <TileLayer url={BASEMAPS[basemap].url} />
        <BasemapAttribution text={BASEMAPS[basemap].attribution} />
        <FlyToSite site={selected} />
        {rings.map((polygon) => (
          <Polygon
            key={`${polygon.member}-${polygon.hour}`}
            positions={polygon.ring.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: palette.ringStroke,
              weight: polygon.hour === 6 ? 1.4 : 0.8,
              fillColor: hourFill(polygon.hour, palette),
              fillOpacity: 1,
            }}
          >
            <Tooltip sticky>
              DEMO · hour {polygon.hour} · member {polygon.member + 1}/10
            </Tooltip>
          </Polygon>
        ))}
        {state.hotspots.map((spot) => (
          <CircleMarker
            key={spot.id}
            center={[spot.lat, spot.lon]}
            radius={5}
            pathOptions={{
              color: palette.hotspotStroke,
              weight: palette.hotspotWeight,
              fillColor: palette.hotspotFill,
              fillOpacity: 0.9,
            }}
          >
            <Tooltip>
              Live hotspot
              {spot.observedAt ? ` · ${spot.observedAt}` : ""}
            </Tooltip>
          </CircleMarker>
        ))}
        {state.shelters.map((shelter) => (
          <CircleMarker
            key={shelter.id}
            center={[shelter.lat, shelter.lon]}
            radius={6}
            pathOptions={{
              color: palette.shelterStroke,
              weight: 1,
              fillColor: palette.shelterFill,
              fillOpacity: 0.7,
            }}
          >
            <Tooltip>
              {shelter.name} · Configured by coordinator (not live data)
            </Tooltip>
          </CircleMarker>
        ))}
        {allSites.map((site) => {
          const active = site.id === selectedId;
          const watch = site.label === "watch";
          const tone = active ? "active" : watch ? "watch" : "normal";
          return (
            <CircleMarker
              key={site.id}
              center={[site.lat, site.lon]}
              radius={active ? 11 : watch ? 7 : 8}
              eventHandlers={{ click: () => onSelect(site.id) }}
              pathOptions={{
                color: palette.siteStroke[tone],
                weight: active ? 2 : 1,
                fillColor: palette.siteFill[tone],
                fillOpacity: active ? 1 : 0.95,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]} className="arca-site-tip">
                {watch ? `Watch · ${site.code}` : `${site.rank} · ${site.code}`}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="absolute top-4 right-4 z-[2] flex overflow-hidden rounded-md border bg-background/90">
        {(Object.keys(BASEMAPS) as BasemapKey[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={basemap === key}
            onClick={() => setBasemap(key)}
            className={`px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase ${
              basemap === key ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {BASEMAPS[key].label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default CommandMap;
