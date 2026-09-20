import type { SensorClass } from "../domain/types.js";

/**
 * DeepFire fuses fifteen sensors whose pixels differ by two orders of
 * magnitude. Everything downstream that reasons about position — the static
 * mask radius, the duplicate radius, the geostationary-only penalty — needs to
 * know which family a detection came from.
 */
export interface SensorInfo {
  code: string;
  satellite: string;
  instrument: string;
  resolutionM: number;
  orbit: "polar" | "geostationary";
  sensorClass: SensorClass;
}

export const SENSORS: Record<string, SensorInfo> = {
  VIIRS_SNPP_NRT:  { code: "VIIRS_SNPP_NRT",  satellite: "Suomi NPP", instrument: "VIIRS",  resolutionM: 375,  orbit: "polar",          sensorClass: "viirs" },
  VIIRS_NOAA20_NRT:{ code: "VIIRS_NOAA20_NRT",satellite: "NOAA-20",   instrument: "VIIRS",  resolutionM: 375,  orbit: "polar",          sensorClass: "viirs" },
  VIIRS_NOAA21_NRT:{ code: "VIIRS_NOAA21_NRT",satellite: "NOAA-21",   instrument: "VIIRS",  resolutionM: 375,  orbit: "polar",          sensorClass: "viirs" },
  MODIS_NRT:       { code: "MODIS_NRT",       satellite: "Terra/Aqua",instrument: "MODIS",  resolutionM: 1000, orbit: "polar",          sensorClass: "modis_class" },
  LANDSAT_NRT:     { code: "LANDSAT_NRT",     satellite: "Landsat 8/9",instrument: "OLI",   resolutionM: 30,   orbit: "polar",          sensorClass: "landsat" },
  SENTINEL_3A:     { code: "SENTINEL_3A",     satellite: "Sentinel-3A",instrument: "SLSTR", resolutionM: 1000, orbit: "polar",          sensorClass: "modis_class" },
  SENTINEL_3B:     { code: "SENTINEL_3B",     satellite: "Sentinel-3B",instrument: "SLSTR", resolutionM: 1000, orbit: "polar",          sensorClass: "modis_class" },
  METOP_B:         { code: "METOP_B",         satellite: "MetOp-B",   instrument: "AVHRR",  resolutionM: 1100, orbit: "polar",          sensorClass: "modis_class" },
  METOP_C:         { code: "METOP_C",         satellite: "MetOp-C",   instrument: "AVHRR",  resolutionM: 1100, orbit: "polar",          sensorClass: "modis_class" },
  MTG_I1:          { code: "MTG_I1",          satellite: "Meteosat-12",instrument: "FCI",   resolutionM: 2000, orbit: "geostationary",  sensorClass: "geostationary" },
  METEOSAT_10:     { code: "METEOSAT_10",     satellite: "Meteosat-10",instrument: "SEVIRI",resolutionM: 3000, orbit: "geostationary",  sensorClass: "geostationary" },
  METEOSAT_9:      { code: "METEOSAT_9",      satellite: "Meteosat-9", instrument: "SEVIRI",resolutionM: 3000, orbit: "geostationary",  sensorClass: "geostationary" },
  GOES_18:         { code: "GOES_18",         satellite: "GOES-18",   instrument: "ABI",    resolutionM: 2000, orbit: "geostationary",  sensorClass: "geostationary" },
  GOES_19:         { code: "GOES_19",         satellite: "GOES-19",   instrument: "ABI",    resolutionM: 2000, orbit: "geostationary",  sensorClass: "geostationary" },
  HIMAWARI_9:      { code: "HIMAWARI_9",      satellite: "Himawari-9",instrument: "AHI",    resolutionM: 2000, orbit: "geostationary",  sensorClass: "geostationary" },
};

/** The sensors DeepFire seeds simulations from by default: sharp and reliable. */
export const HIGH_CONFIDENCE_SOURCES = [
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
  "LANDSAT_NRT",
];

export function sensorInfo(source: string | null | undefined): SensorInfo | null {
  if (!source) return null;
  return SENSORS[source.trim().toUpperCase()] ?? null;
}

export function classifySensor(source: string | null | undefined): SensorClass {
  const info = sensorInfo(source);
  if (info) return info.sensorClass;
  // Unknown code: fall back on the name so a new satellite is not mis-bucketed.
  const value = (source ?? "").toUpperCase();
  if (value.includes("LANDSAT")) return "landsat";
  if (value.includes("VIIRS")) return "viirs";
  if (value.includes("MODIS") || value.includes("SENTINEL") || value.includes("METOP")) {
    return "modis_class";
  }
  if (value.includes("GOES") || value.includes("METEOSAT") || value.includes("MTG") || value.includes("HIMAWARI")) {
    return "geostationary";
  }
  return "unknown";
}

export function isGeostationary(source: string | null | undefined): boolean {
  return classifySensor(source) === "geostationary";
}

export function sensorLabel(source: string | null | undefined): string {
  const info = sensorInfo(source);
  if (!info) return source ?? "unknown sensor";
  return `${info.satellite} ${info.instrument} (${info.resolutionM} m)`;
}
