"use client";

import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { CommandState, RankedSite } from "@/lib/types";
import "leaflet/dist/leaflet.css";

type Props = {
  state: CommandState;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function FlyToSite({ site }: { site: RankedSite | undefined }) {
  const map = useMap();

  useEffect(() => {
    if (!site) return;
    map.flyTo([site.lat, site.lon], 12, { duration: 0.6 });
  }, [map, site]);

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

function hourFill(hour: number, satellite: boolean) {
  const alpha = 0.08 + hour * 0.045;
  return satellite ? `rgba(255, 138, 76, ${alpha})` : `rgba(156, 72, 32, ${alpha})`;
}

export function CommandMap({ state, selectedId, onSelect }: Props) {
  const allSites = [...state.sites, ...(state.watch ?? [])];
  const selected = allSites.find((site) => site.id === selectedId);
  const rings = state.fire.polygons.filter((polygon) => polygon.member === state.fire.displayMember);
  const [basemap, setBasemap] = useState<BasemapKey>("map");
  const satellite = basemap === "satellite";

  return (
    <div className="relative size-full">
      <MapContainer
        center={[41.74, 1.85]}
        zoom={11}
        className="arca-map size-full"
        zoomControl={false}
        attributionControl
        scrollWheelZoom
      >
        <TileLayer key={basemap} attribution={BASEMAPS[basemap].attribution} url={BASEMAPS[basemap].url} />
        <FlyToSite site={selected} />
        {rings.map((polygon) => (
          <Polygon
            key={`${polygon.member}-${polygon.hour}`}
            positions={polygon.ring.map(([lon, lat]) => [lat, lon])}
            pathOptions={{
              color: satellite ? "rgba(255, 176, 120, 0.75)" : "rgba(124, 58, 28, 0.45)",
              weight: polygon.hour === 6 ? 1.4 : 0.8,
              fillColor: hourFill(polygon.hour, satellite),
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
              color: "#7c3a1c",
              weight: 1,
              fillColor: "#b4532a",
              fillOpacity: 0.9,
            }}
          >
            <Tooltip>
              Live hotspot
              {spot.observedAt ? ` · ${spot.observedAt}` : ""}
            </Tooltip>
          </CircleMarker>
        ))}
        {(state.shelters ?? []).map((shelter) => (
          <CircleMarker
            key={shelter.id}
            center={[shelter.lat, shelter.lon]}
            radius={6}
            pathOptions={{ color: "#3f6212", weight: 1, fillColor: "#84cc16", fillOpacity: 0.7 }}
          >
            <Tooltip>
              {shelter.name} · Configured by coordinator (not live data)
            </Tooltip>
          </CircleMarker>
        ))}
        {allSites.map((site) => {
          const active = site.id === selectedId;
          const watch = site.label === "watch";
          return (
            <CircleMarker
              key={site.id}
              center={[site.lat, site.lon]}
              radius={active ? 11 : watch ? 7 : 8}
              eventHandlers={{ click: () => onSelect(site.id) }}
              pathOptions={{
                color: active ? "#1c1917" : watch ? "#78716c" : "#44403c",
                weight: active ? 2 : 1,
                fillColor: active ? "#1c1917" : watch ? "#e7e5e4" : "#fafaf9",
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
