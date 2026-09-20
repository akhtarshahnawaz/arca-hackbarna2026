import type { Simulation, SpreadFeatureCollection } from "../domain/types.js";

export interface DeepFireTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface HotspotProperties {
  cluster_id: string | null;
  observed_at: string;
  source: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  fire_radiative_power: number | null;
  country: string | null;
  active: boolean;
}

export interface ClusterProperties {
  first_observed: string;
  last_observed: string;
  active: boolean;
}

export interface PerimeterProperties {
  cluster_id: string;
  computed_at: string;
  observed_watermark: string | null;
  n_hotspots: number;
  area_m2: number | null;
  perimeter_m: number | null;
  algo_version: string;
  active: boolean;
}

export interface StaticHeatSourceProperties {
  global_id?: string | null;
  type: string;
  source?: string | null;
  method?: string | null;
  remarks?: string | null;
  year?: number | null;
}

export type DeepFireCollection =
  | "hotspots"
  | "clusters"
  | "satellite-perimeters"
  | "static-heat-sources";

export interface ItemsQuery {
  bbox?: string;
  filter?: string;
  limit?: number;
  /** Stop after this many pages. Guards against a runaway export. */
  maxPages?: number;
  sortby?: string;
}

export interface SimulationRequest {
  clusterId?: string;
  latitude?: number;
  longitude?: number;
  durationHours: number;
  model?: "elmfire" | "forefire";
  ensembleMembers?: number;
  sources?: string[];
  lookbackHours?: number;
}

export type { Simulation, SpreadFeatureCollection };
