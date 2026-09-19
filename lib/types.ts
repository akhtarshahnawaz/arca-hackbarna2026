export type LonLat = [number, number];

export type SiteKind = "care_home" | "hospital" | "school" | "farm" | "household";

export type ReachLabel = "likely" | "possible" | "watch";

export type FreshnessKind = "live" | "maybe_old" | "demo";

export type ConfirmationStatus = "reported" | "verified";

export type SpeciesCount = {
  species: string;
  registeredCapacity: number | null;
  confirmedCount: number | null;
};

export type SiteInput = {
  id: string;
  code: string;
  kind: SiteKind;
  municipality: string;
  lon: number;
  lat: number;
  animals: SpeciesCount[];
  hasOwnTransport: boolean | null;
  confirmedAt: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  capacityUpdatedAt: string | null;
  source: "registry" | "resident" | "osm" | "demo";
  shelterHint: string;
  notes: string;
};

export type HourPolygon = {
  hour: number;
  member: number;
  ring: LonLat[];
};

export type RankedSite = SiteInput & {
  rank: number;
  pReach: number;
  runsReach: number;
  ensembleMembers: number;
  tArrival: number | null;
  tEvac: number;
  spareTime: number | null;
  label: ReachLabel;
  arrivalHours: number[];
};

export type RankedPartition = {
  ranked: RankedSite[];
  watch: RankedSite[];
};

export type Hotspot = {
  id: string;
  lon: number;
  lat: number;
  observedAt: string | null;
  clusterId: string | null;
  confidence: string | null;
  country: string | null;
};

export type DataSourceStatus = {
  id: string;
  label: string;
  kind: FreshnessKind;
  detail: string;
  fetchedAt: string | null;
  ok: boolean;
};

export type CommandState = {
  generatedAt: string;
  fire: {
    id: string;
    name: string;
    municipality: string;
    ignition: LonLat;
    mode: "demo";
    ensembleMembers: number;
    horizonHours: number;
    polygons: HourPolygon[];
    displayMember: number;
  };
  sites: RankedSite[];
  watch: RankedSite[];
  hotspots: Hotspot[];
  sources: DataSourceStatus[];
  banners: string[];
};

export type EvacConfig = {
  horizonHours: number;
  ensembleMembers: number;
  note: string;
  byTypeHours: Record<string, number>;
  farm: {
    baseHours: number;
    per100SheepHours: number;
    per100GoatsHours: number;
    pigsHours: number;
    horsesHours: number;
  };
};
