"use client";

import { useEffect, useMemo, useRef } from "react";
import type { LatLngBoundsExpression, LatLngTuple } from "leaflet";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import { feedLabel, isCorroborated, isOnStaticHeat } from "@/lib/crosscheck";
import { urgencyTier } from "@/lib/urgency";
import type { CommandState, RankedSite } from "@/lib/types";
import "leaflet/dist/leaflet.css";

export type BasemapKey = "map" | "satellite";

type Props = {
  state: CommandState;
  selectedId: string | null;
  onSelect: (id: string) => void;
  basemap: BasemapKey;
};

function FlyToSite({ site }: { site: RankedSite | undefined }) {
  const map = useMap();
  const flownId = useRef<string | null>(null);

  useEffect(() => {
    if (!site || site.id === flownId.current) return;
    flownId.current = site.id;
    map.flyTo([site.lat, site.lon], 12, { duration: 0.6 });
  }, [map, site]);

  return null;
}

/**
 * Fit after mount. Leaflet caches a 0×0 size on the first frame, so a
 * `bounds` prop on MapContainer parks markers on the container edge.
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
 * Keeps Leaflet's cached container size in step with the panel.
 *
 * Leaflet listens for `window` resize only, and `FitFeatures` invalidates once.
 * The console resizes this panel without a window resize — collapsing the
 * context strip, or an alert strip appearing — which leaves Leaflet painting
 * tiles and culling markers against the old edge until the window changes.
 */
function InvalidateOnResize() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Coalesce to one call per frame: a toggle fires several entries as the
      // flex layout settles.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

/**
 * Keep the tile layer mounted so Leaflet swaps the URL in place.
 * Attribution is not reactive on the layer, so it goes through the control.
 */
function SyncBasemapUrl({ url }: { url: string }) {
  const map = useMap();

  useEffect(() => {
    map.eachLayer((layer) => {
      const tile = layer as { setUrl?: (next: string) => void };
      if (typeof tile.setUrl === "function") tile.setUrl(url);
    });
  }, [map, url]);

  return null;
}

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

const TIER_MARKER: Record<"late" | "now" | "prepare" | "none", string> = {
  late: "#b91c1c",
  now: "#c2410c",
  prepare: "#15803d",
  none: "#a8a29e",
};

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
    confirmStroke: "#dc2626",
    detectionStroke: "#9a3412",
    detectionFill: "#fdba74",
    heatStroke: "rgba(87, 83, 78, 0.8)",
    heatFill: "rgba(120, 113, 108, 0.25)",
  },
  satellite: {
    ringAlphaBase: 0.22,
    ringAlphaStep: 0.055,
    ringFill: "255, 138, 76",
    ringStroke: "rgba(255, 176, 120, 0.75)",
    hotspotStroke: "#fee2e2",
    hotspotFill: "#dc2626",
    hotspotWeight: 1.5,
    shelterStroke: "#1a2e05",
    shelterFill: "#bef264",
    confirmStroke: "#fef08a",
    detectionStroke: "#fed7aa",
    detectionFill: "#f97316",
    heatStroke: "rgba(226, 232, 240, 0.9)",
    heatFill: "rgba(148, 163, 184, 0.3)",
  },
} as const;

type Palette = (typeof PALETTES)[BasemapKey];

function hourFill(hour: number, palette: Palette) {
  const alpha = palette.ringAlphaBase + hour * palette.ringAlphaStep;
  return `rgba(${palette.ringFill}, ${alpha})`;
}

const FALLBACK_CENTER: LatLngTuple = [41.74, 1.85];

/**
 * Shelters sit 30–45 km south-west of the fire. A fire-centred zoom hides them.
 * Hotspots are left out: the Deepfire box is all of Catalonia and would shrink
 * the hour rings to a few pixels.
 */
function featureBounds(state: CommandState): LatLngBoundsExpression | undefined {
  const points: LatLngTuple[] = [
    ...state.sites.map((site): LatLngTuple => [site.lat, site.lon]),
    ...(state.watch ?? []).map((site): LatLngTuple => [site.lat, site.lon]),
    ...(state.shelters ?? []).map((shelter): LatLngTuple => [shelter.lat, shelter.lon]),
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

export function CommandMap({ state, selectedId, onSelect, basemap }: Props) {
  const allSites = [...state.sites, ...(state.watch ?? [])];
  const selected = allSites.find((site) => site.id === selectedId);
  const rings = state.fire.polygons.filter((polygon) => polygon.member === state.fire.displayMember);
  const palette = PALETTES[basemap];
  const bounds = useMemo(() => featureBounds(state), [state]);

  return (
    <div className="relative size-full" data-basemap={basemap}>
      <MapContainer
        center={FALLBACK_CENTER}
        zoom={11}
        className="arca-map size-full"
        zoomControl
        attributionControl
        scrollWheelZoom
      >
        <FitFeatures bounds={bounds} />
        <InvalidateOnResize />
        <TileLayer url={BASEMAPS[basemap].url} />
        <SyncBasemapUrl url={BASEMAPS[basemap].url} />
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
            <Tooltip sticky>Fire in about {polygon.hour} hours</Tooltip>
          </Polygon>
        ))}
        {/* One polygon per part: a two-kiln site masks and draws both. */}
        {(state.heatSources ?? []).flatMap((heat) =>
          heat.rings.map((ring, part) => (
            <Polygon
              key={`${heat.id}-${part}`}
              positions={ring.map(([lon, lat]): LatLngTuple => [lat, lon])}
              pathOptions={{
                color: palette.heatStroke,
                weight: 1,
                dashArray: "3 3",
                fillColor: palette.heatFill,
                fillOpacity: 1,
              }}
            >
              <Tooltip sticky>
                Static heat source · {heat.label}
                {heat.year ? ` · mapped ${heat.year}` : ""}
              </Tooltip>
            </Polygon>
          )),
        )}
        {(state.detections ?? []).map((detection) => (
          <CircleMarker
            key={detection.id}
            center={[detection.lat, detection.lon]}
            radius={3}
            pathOptions={{
              color: palette.detectionStroke,
              weight: 1,
              fillColor: palette.detectionFill,
              fillOpacity: 0.85,
            }}
          >
            <Tooltip>
              {feedLabel[detection.feed]} detection
              {detection.observedAt ? ` · ${detection.observedAt}` : ""}
            </Tooltip>
          </CircleMarker>
        ))}
        {state.hotspots.map((spot) => {
          // Same predicate the ranking uses, so the badge on the map and the
          // pin in the list can never disagree.
          const agreed = isCorroborated(spot);
          const chimney = isOnStaticHeat(spot);
          return (
            <CircleMarker
              key={spot.id}
              center={[spot.lat, spot.lon]}
              radius={agreed ? 8 : 5}
              pathOptions={{
                color: agreed ? palette.confirmStroke : palette.hotspotStroke,
                weight: agreed ? 2.5 : palette.hotspotWeight,
                fillColor: palette.hotspotFill,
                fillOpacity: chimney ? 0.35 : 0.9,
                dashArray: chimney ? "2 3" : undefined,
              }}
            >
              <Tooltip>
                {agreed
                  ? `Confirmed by ${spot.confirmedBy.map((feed) => feedLabel[feed]).join(" + ")}`
                  : "Deepfire hotspot only"}
                {spot.matchKm !== null ? ` · ${spot.matchKm} km apart` : ""}
                {chimney ? ` · on static heat source (${spot.staticHeat})` : ""}
                {spot.observedAt ? ` · ${spot.observedAt}` : ""}
              </Tooltip>
            </CircleMarker>
          );
        })}
        {(state.shelters ?? []).map((shelter) => (
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
          const fill = TIER_MARKER[urgencyTier(site)];
          return (
            <CircleMarker
              key={site.id}
              center={[site.lat, site.lon]}
              radius={active ? 11 : watch ? 4.5 : 8}
              eventHandlers={{ click: () => onSelect(site.id) }}
              pathOptions={{
                color: active ? (basemap === "satellite" ? "#ffffff" : "#1c1917") : fill,
                weight: active ? 2.5 : 1,
                fillColor: fill,
                fillOpacity: active ? 1 : watch ? 0.32 : 0.9,
              }}
            >
              <Tooltip
                key={`${site.id}-tip-${active ? "on" : "off"}`}
                permanent={active}
                direction="top"
                offset={[0, -8]}
                className="arca-site-tip"
              >
                {site.locationQuality === "municipality_centroid"
                  ? `Approximate · ${site.name ?? site.code}`
                  : watch
                    ? `Watch · ${site.name ?? site.code}`
                    : `${site.rank} · ${site.name ?? site.code}`}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}

export default CommandMap;
