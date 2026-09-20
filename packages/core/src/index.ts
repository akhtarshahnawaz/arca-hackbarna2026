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

/** Areas ARCA is tuned for. Catalonia is the deep-coverage regime. */
export const AOI = {
  CATALONIA: "0.15,40.50,3.35,42.90",
  SPAIN: "-9.50,35.90,4.40,43.90",
  BAGES: "1.60,41.60,2.10,42.00",
} as const;
