/**
 * @arca/core — every decision ARCA makes, as pure functions.
 *
 * Nothing in this package touches a database, a queue or a socket. That is what
 * makes the ranking testable against recorded fixtures and what lets the agent,
 * the HTTP API and the replay runner share one implementation rather than three
 * that drift.
 */

export * from "./domain/types.js";
export * from "./geo/index.js";
export { PlaceResolver, describePosition } from "./geo/places.js";
export type { PlaceLookupOptions } from "./geo/places.js";
export * from "./config/index.js";
export * from "./util/http.js";

export * as cql from "./deepfire/cql.js";
export { DeepFireClient, memoryTokenStore } from "./deepfire/client.js";
export type { TokenStore, DeepFireClientOptions } from "./deepfire/client.js";
export type {
  ClusterProperties,
  HotspotProperties,
  PerimeterProperties,
  SimulationRequest,
  StaticHeatSourceProperties,
  ItemsQuery,
} from "./deepfire/types.js";

export {
  SENSORS,
  HIGH_CONFIDENCE_SOURCES,
  classifySensor,
  isGeostationary,
  sensorInfo,
  sensorLabel,
} from "./cleaning/sources.js";
export { StaticSourceIndex, bufferMetersFor } from "./cleaning/mask.js";
export { cleanHotspots, confirmationScore } from "./cleaning/clean.js";
export type { CleanOptions, CleanResult } from "./cleaning/clean.js";

export {
  PROBABILITY_FLOOR,
  bandsFromSimulation,
  fallbackBands,
  isEnsemble,
  outerBand,
  probabilityAt,
  reachStats,
  spreadFrames,
  unionGeometries,
} from "./spread/bands.js";
export type { BandOptions, SpreadFrame } from "./spread/bands.js";

export { TalaiaClient } from "./talaia/client.js";
export type {
  ExposureRequest,
  TalaiaClientOptions,
  TalaiaEvent,
  TalaiaLimits,
} from "./talaia/client.js";

export { estimateEvacMinutes, livestockUnitsOf, resolvePeople } from "./ranking/evac.js";
export type { EvacInput } from "./ranking/evac.js";
export { ACTION_LABELS, ACTION_SEVERITY, decideAction } from "./ranking/actions.js";
export type { ActionDecision, ActionInput } from "./ranking/actions.js";
export { compareSites, formatMinutes, rankSites, reachCopy, spareCopy } from "./ranking/rank.js";
export type { RankOptions } from "./ranking/rank.js";
export { rankingDiff } from "./ranking/diff.js";

export {
  EXTRACTION_EXAMPLES,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  siteReportSchema,
} from "./extraction/schema.js";
export type { SiteReportExtraction } from "./extraction/schema.js";

export { describeWind, fetchWeather } from "./weather/open-meteo.js";

/**
 * Areas ARCA can watch.
 *
 * Catalonia first because that is where Talaia's registry coverage is deep —
 * schools, care homes, REGA livestock holdings, all with capacities and phone
 * numbers. Outside it Talaia still answers, from OpenStreetMap, which gives you
 * the buildings without the people in them.
 *
 * The wider areas exist because a wildfire system that can only look at one
 * comarca will spend most of the year looking at nothing. Catalonia can be
 * quiet while Huelva and Coimbra are burning, and being able to see that is the
 * difference between "no fires" and "no fires here".
 */
export interface WatchArea {
  id: string;
  label: string;
  bbox: string;
  /** What Talaia will be able to say about assets inside it. */
  coverage: "deep" | "osm";
  note: string;
}

export const WATCH_AREAS: WatchArea[] = [
  {
    id: "catalonia",
    label: "Catalonia",
    bbox: "0.15,40.50,3.35,42.90",
    coverage: "deep",
    note: "Full registry coverage: capacities, contacts and livestock holdings.",
  },
  {
    id: "spain",
    label: "Spain and the Balearics",
    bbox: "-9.50,35.90,4.40,43.90",
    coverage: "osm",
    note: "Registry depth is Catalan only. Elsewhere, sites come from OpenStreetMap with class-default occupancies.",
  },
  {
    id: "iberia",
    label: "Iberia and the Maghreb",
    bbox: "-10.00,30.00,5.00,45.00",
    coverage: "osm",
    note: "The widest view, for finding a fire when Catalonia is quiet. Exposure is OpenStreetMap-derived outside Catalonia.",
  },
];

export function watchArea(id: string | null | undefined): WatchArea | null {
  if (!id) return null;
  return WATCH_AREAS.find((area) => area.id === id.toLowerCase()) ?? null;
}

/** Shorthand for the areas, kept for scripts and tests. */
export const AOI = {
  CATALONIA: "0.15,40.50,3.35,42.90",
  SPAIN: "-9.50,35.90,4.40,43.90",
  IBERIA: "-10.00,30.00,5.00,45.00",
  BAGES: "1.60,41.60,2.10,42.00",
} as const;
