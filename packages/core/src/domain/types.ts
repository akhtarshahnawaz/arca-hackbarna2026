/**
 * The ARCA domain model.
 *
 * These types are the contract between the pipeline, the agent and the web UI.
 * Everything a coordinator sees on screen is one of these shapes, and every
 * number carries enough context to be defended: where it came from, what was
 * assumed, and how confident the source was.
 */

import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";

import type { Position } from "../geo/index.js";

// ---------------------------------------------------------------------------
// Detections
// ---------------------------------------------------------------------------

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/**
 * Sensor families, used to pick a static-source buffer that matches the pixel
 * footprint. A 3 km Meteosat pixel and a 30 m Landsat pixel cannot share one
 * exclusion radius without either leaking flares or masking real fires.
 */
export type SensorClass = "landsat" | "viirs" | "modis_class" | "geostationary" | "unknown";

/** Why a detection was excluded from the ignition set. Never silently dropped. */
export type HotspotFlag =
  | "outside_aoi"
  | "static_source"
  | "low_confidence_uncorroborated"
  | "duplicate"
  | "stale";

export interface Hotspot {
  id: string;
  clusterId: string | null;
  position: Position;
  observedAt: string;
  source: string;
  sensorClass: SensorClass;
  confidence: Confidence;
  fireRadiativePowerMw: number | null;
  country: string | null;
  active: boolean;
}

export interface CleanedHotspot extends Hotspot {
  flags: HotspotFlag[];
  /** Human-readable reason attached to the first disqualifying flag. */
  reason: string | null;
  /** Name of the static heat source this pixel sits on, when it does. */
  staticSourceName: string | null;
  staticSourceType: string | null;
  /** False when any flag disqualifies the pixel from seeding a simulation. */
  usable: boolean;
}

export interface StaticHeatSource {
  id: string;
  type: string;
  remarks: string | null;
  geometry: Polygon | MultiPolygon;
}

export interface FireCluster {
  id: string;
  position: Position;
  firstObserved: string;
  lastObserved: string;
  active: boolean;
}

/**
 * A live cluster, described well enough to choose between it and nine others.
 *
 * DeepFire's cluster record carries four fields — id, first seen, last seen,
 * active — which is not enough to pick one off a list. Everything else here is
 * derived from that cluster's own detections in the same pass the watcher
 * already makes, so browsing the feed costs no extra queries per cluster.
 *
 * Crucially this is every active cluster, not only the ones that clear the
 * confirmation bar. A coordinator looking at the feed needs to see what ARCA
 * rejected as much as what it accepted, with the score that decided it.
 */
export interface ClusterSummary {
  clusterId: string;
  position: Position;
  /** Nearest settlement, resolved by reverse geocoding. Null if unavailable. */
  place: string | null;
  firstObserved: string;
  lastObserved: string;
  /** Detections that survived cleaning. */
  detections: number;
  /** Everything DeepFire reported for this cluster inside the window. */
  rawDetections: number;
  /** Detections dropped as known persistent heat sources. */
  maskedDetections: number;
  /**
   * Why the rest were dropped, when any were.
   *
   * A cluster showing "0 detections" with no explanation invites the reasonable
   * conclusion that the system is broken. "12 seen, all stale" is a different
   * statement, and the operator can judge it.
   */
  dropped: Array<{ reason: string; count: number }>;
  /** Distinct satellites that reported it, usable or not. */
  sources: string[];
  /** Of those, the ones whose detections survived cleaning. */
  corroboratingSources: string[];
  totalFrpMw: number | null;
  maxFrpMw: number | null;
  /** The strongest confidence grade any detection carried. */
  confidence: Confidence | null;
  /** Greatest distance between two usable detections, in metres. */
  spanM: number;
  hasPerimeter: boolean;
  score: number;
  classification: ConfirmationClass;
  /** Set once ARCA is working this cluster as an incident. */
  incidentId: string | null;
  incidentStatus: IncidentStatus | null;
}

/**
 * A synthetic scenario, described for the picker.
 *
 * Replay bundles are the answer to a demo problem — a wildfire system may have
 * no wildfire — and they are also how the pipeline is regression-tested. Each
 * one is labelled as synthetic everywhere it appears, including here, so a
 * scenario can never be read as a live fire.
 */
export interface ScenarioSummary {
  /** Bundle file name, and the id used to start it. */
  name: string;
  label: string;
  place: string;
  blurb: string;
  synthetic: boolean;
  position: Position;
  firstObserved: string;
  lastObserved: string;
  detections: number;
  /** Assets the bundled exposure carries, when it has one. */
  assets: number | null;
  peopleEstimate: number | null;
  /** Set once this scenario has been started in this deployment. */
  incidentId: string | null;
}

/** One pass over the feed: what is burning, and what ARCA made of it. */
export interface ClusterSurvey {
  clusters: ClusterSummary[];
  bbox: string;
  at: string;
  /** Set when the feed could not be read; `clusters` is then whatever is cached. */
  error: string | null;
  /** True when the mask was unavailable, so nothing could be masked this pass. */
  maskIncomplete: boolean;
}

// ---------------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------------

export type ConfirmationClass = "CONFIRMED" | "CANDIDATE" | "NOISE";

export interface ScoreComponent {
  /** Stable key so the UI can render an icon and the agent can cite it. */
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface ConfirmationResult {
  score: number;
  classification: ConfirmationClass;
  components: ScoreComponent[];
  distinctSources: string[];
  usableHotspots: number;
  maxFrpMw: number | null;
  maskedHotspots: number;
}

// ---------------------------------------------------------------------------
// Spread
// ---------------------------------------------------------------------------

export type SimulationStatus = "QUEUED" | "COMPLETED" | "NO_SPREAD" | "FAILED";

export interface SpreadFeatureProperties {
  hour: number;
  elapsed_seconds?: number;
  /**
   * Share of ensemble members that had burned this polygon by `hour`.
   * Absent on single-member runs, where it is treated as 1.
   */
  burn_probability?: number;
}

export type SpreadFeature = Feature<
  Polygon | MultiPolygon,
  SpreadFeatureProperties
>;

export type SpreadFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  SpreadFeatureProperties
>;

export interface SimulationSummary {
  burnedAreaM2?: number;
  edgeReached?: boolean;
  windSpeedAvgMs?: number;
  windDirectionAvg?: number;
}

export interface Simulation {
  id: string;
  status: SimulationStatus;
  clusterId?: string | null;
  model?: string;
  durationHours?: number;
  ensembleMembers?: number;
  sources?: string[];
  lookbackHours?: number;
  locationName?: string | null;
  ignitionPointCount?: number;
  ignition?: FeatureCollection | null;
  summary?: SimulationSummary | null;
  result?: SpreadFeatureCollection | null;
  errorMessage?: string | null;
}

/** Properties Talaia reads to assign each asset to its earliest arrival band. */
export interface BandProperties {
  band: string;
  minutes: number;
  hour: number;
  /** Probability threshold this band's footprint was cut at. */
  probabilityFloor: number;
  areaM2: number;
}

export type BandFeature = Feature<
  Polygon | MultiPolygon,
  BandProperties
>;

export type BandFeatureCollection = FeatureCollection<
  Polygon | MultiPolygon,
  BandProperties
>;

export interface ReachStats {
  /** Burn probability at the site at the end of the horizon. */
  pReach: number;
  /** First minute at which probability reaches the conservative floor. */
  arrivalMinutesP20: number | null;
  /** First minute at which a majority of runs have arrived. */
  arrivalMinutesP50: number | null;
  runsReaching: number;
  runsTotal: number;
  singleRun: boolean;
}

// ---------------------------------------------------------------------------
// Exposure (Talaia)
// ---------------------------------------------------------------------------

export interface AssetCapacity {
  places?: number | null;
  people?: number | null;
  basis?: string | null;
  confidence?: number | null;
}

export interface AssetValuation {
  total_eur?: number | null;
  method?: string | null;
  confidence?: number | null;
  assumptions?: string[];
}

export interface AssetContacts {
  phone?: string[];
  email?: string[];
  operator?: string | null;
}

export interface AssetProvenance {
  source_id: string;
  source_ref?: string | null;
  fields?: string[];
}

export interface ExposureAsset {
  id: string;
  category: string;
  subcategory: string;
  name: string;
  geometry?: Geometry | null;
  address?: Record<string, unknown> | null;
  contacts?: AssetContacts | null;
  capacity?: AssetCapacity | null;
  occupancy_note?: string | null;
  valuation?: AssetValuation | null;
  vulnerability?: number | null;
  criticality?: number | null;
  hazardous?: boolean;
  response_asset?: boolean;
  human_bearing?: boolean;
  exposure?: {
    band?: string | null;
    band_index?: number | null;
    band_minutes?: number | null;
    distance_to_front_m?: number | null;
    inside_aoi?: boolean;
    priority_score?: number | null;
  } | null;
  provenance?: AssetProvenance[];
  confidence?: number | null;
  merged_count?: number | null;
  possible_duplicate_of?: string | null;
}

export interface ExposureBand {
  band: string;
  minutes?: number | null;
  area_km2?: number | null;
  asset_count?: number | null;
  people_estimate?: number | null;
  population_resident?: number | null;
  total_value_eur?: number | null;
  critical_assets?: number | null;
  hazardous_assets?: number | null;
}

export interface ExposureSummary {
  asset_count?: number | null;
  people_estimate?: number | null;
  population_resident?: number | null;
  total_value_eur?: number | null;
  critical_assets?: number | null;
  hazardous_assets?: number | null;
  response_assets?: number | null;
  livestock_units?: number | null;
  coverage_regime?: string | null;
  top_priority?: Array<{ name?: string; priority_score?: number; phone?: string }>;
}

export interface PopulationCell {
  cell_id: string;
  lon: number;
  lat: number;
  population?: number | null;
  population_in_aoi?: number | null;
  overlap_fraction?: number | null;
  density_per_km2?: number | null;
  band?: string | null;
}

export interface ExposureReport {
  summary: ExposureSummary;
  bands: ExposureBand[];
  assets: ExposureAsset[];
  networks?: unknown;
  population?: {
    total?: number | null;
    cell_count?: number | null;
    peak_density_per_km2?: number | null;
    cells?: PopulationCell[];
  } | null;
  sources?: unknown;
  warnings: string[];
  timing?: Record<string, unknown> | null;
  /** Set by ARCA, not Talaia: which step of the failsafe ladder produced this. */
  degraded?: ExposureDegradation | null;
}

export type ExposureDegradation =
  | { mode: "full" }
  | { mode: "no_live_osm"; reason: string }
  | { mode: "summary_only"; reason: string }
  | { mode: "tiled"; reason: string; tiles: number }
  | { mode: "last_good"; reason: string; capturedAt: string }
  | { mode: "fixture"; reason: string; name: string };

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type ProtectiveAction =
  | "EVACUATE_NOW"
  | "SHELTER_CANDIDATE"
  | "PREPARE"
  | "MONITOR"
  | "EXCLUSION_ZONE"
  | "RESOURCE_AT_RISK";

export type SiteStatus =
  | "unnotified"
  | "approved"
  | "calling"
  | "reported"
  | "unreachable"
  | "evacuated"
  | "sheltering"
  | "do_not_call";

export type PeopleBasis = "reported" | "registered" | "class_default" | "unknown";

export interface EvacEstimate {
  /**
   * Minutes to get the *people* out.
   *
   * This and only this is what spare time is computed against, because the
   * decision it feeds is a life-safety decision. Livestock is counted
   * separately below — see the note on `livestockMinutes`.
   */
  minutes: number;
  /**
   * Minutes to move the animals, if there are any.
   *
   * Kept apart from `minutes` deliberately. An earlier version added the two
   * together, and on live registry data that put unnamed sheep farms at the top
   * of every ranked list: two people who can walk out in five minutes, six
   * thousand animals that cannot be moved in twelve hours, and a combined
   * estimate that read as "these people cannot escape". They can. The animals
   * cannot, which is a real and serious loss — and a different instruction.
   */
  livestockMinutes: number;
  basis: PeopleBasis;
  people: number;
  assumptions: string[];
}

export interface RankedSite {
  id: string;
  assetId: string;
  name: string;
  category: string;
  subcategory: string;
  position: Position | null;
  band: string | null;
  bandMinutes: number | null;
  distanceToFrontM: number | null;
  priorityScore: number;

  reach: ReachStats;
  arrivalMinutes: number | null;
  evac: EvacEstimate;
  /** Arrival minus evacuation need. Negative means the clock has run out. */
  spareMinutes: number | null;

  action: ProtectiveAction;
  rank: number;
  tier: "likely" | "possible" | "watch";
  status: SiteStatus;

  humanBearing: boolean;
  hazardous: boolean;
  responseAsset: boolean;
  peopleEstimate: number;
  livestockUnits: number | null;
  valueEur: number | null;

  contacts: AssetContacts | null;
  capacity: AssetCapacity | null;
  valuation: AssetValuation | null;
  provenance: AssetProvenance[];
  reported: SiteReport | null;
  occupancyNote: string | null;
  /** Machine-readable reasons the row sits where it does. */
  explanation: SiteExplanation;
}

export interface SiteExplanation {
  runsReaching: number;
  runsTotal: number;
  arrivalMinutes: number | null;
  arrivalMinutesP50: number | null;
  evacMinutes: number;
  peopleBasis: PeopleBasis;
  people: number;
  assumptions: string[];
  actionReason: string;
  singleRun: boolean;
}

export interface RankingResult {
  version: number;
  computedAt: string;
  ranked: RankedSite[];
  watch: RankedSite[];
  totals: {
    sites: number;
    peopleAtFacilities: number;
    populationResident: number;
    livestockUnits: number;
    valueEur: number;
    evacuateNow: number;
    shelterCandidates: number;
    hazardous: number;
  };
}

export interface RankingDiffEntry {
  siteId: string;
  name: string;
  fromRank: number | null;
  toRank: number | null;
  fromAction: ProtectiveAction | null;
  toAction: ProtectiveAction | null;
  reason: string;
}

export interface RankingDiff {
  fromVersion: number;
  toVersion: number;
  entries: RankingDiffEntry[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Phone reports
// ---------------------------------------------------------------------------

export interface SiteReport {
  peoplePresent: number | null;
  nonAmbulatory: number | null;
  vehicles: string[];
  needsHelp: boolean | null;
  willFollowAction: boolean | null;
  alreadyEvacuated: boolean | null;
  livestockPresent: number | null;
  corrections: string[];
  notes: string | null;
  confidence: number;
  capturedAt: string;
  source: "phone" | "manual" | "telegram";
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

export type IncidentStatus = "candidate" | "confirmed" | "monitoring" | "closed";

export interface IncidentWeather {
  windSpeedMs: number | null;
  windGustMs: number | null;
  windDirectionDeg: number | null;
  relativeHumidity: number | null;
  temperatureC: number | null;
  observedAt: string;
  source: string;
}

export interface Incident {
  id: string;
  clusterId: string;
  name: string;
  status: IncidentStatus;
  replay: boolean;
  position: Position;
  firstObserved: string;
  lastObserved: string;
  confirmation: ConfirmationResult;
  weather: IncidentWeather | null;
  createdAt: string;
  updatedAt: string;
}

export type TimelineKind =
  | "detected"
  | "confirmed"
  | "simulation_requested"
  | "simulation_completed"
  | "simulation_failed"
  | "exposure_queried"
  | "exposure_computed"
  | "exposure_degraded"
  | "ranked"
  | "briefed"
  | "approval_requested"
  | "approved"
  | "denied"
  | "call_dispatched"
  | "call_failed"
  | "call_completed"
  | "report_extracted"
  | "status_changed"
  | "reranked"
  | "note";

export interface TimelineEvent {
  id: string;
  incidentId: string;
  at: string;
  kind: TimelineKind;
  actor: string;
  message: string;
  data?: Record<string, unknown> | null;
}
