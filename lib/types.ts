export type LonLat = [number, number];

export type SiteKind = "care_home" | "hospital" | "school" | "farm" | "household";

export type ReachLabel = "likely" | "possible" | "watch";

export type FreshnessKind = "live" | "maybe_old" | "demo";

export type ConfirmationStatus = "reported" | "verified";

export type ConfirmationChannel = "phone" | "telegram" | "console";

export type Shelter = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  pets_allowed: boolean;
  municipality?: string;
  notes?: string;
};

export type ShelterConfig = {
  label: string;
  note: string;
  shelters: Shelter[];
};

export type VoiceCallStatus =
  | "awaiting_approval"
  | "approved"
  | "dialing"
  | "recording"
  | "reported"
  | "empty"
  | "failed"
  | "denied"
  | "stubbed";

export type VoiceCallSummary = {
  id: string;
  siteId: string;
  toLast4: string;
  status: VoiceCallStatus;
  attempt: number;
  emptyHangup: boolean;
  flagged: boolean;
  telegramFollowup: boolean;
  transcript: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VoiceStatus = {
  vonageConfigured: boolean;
  slngConfigured: boolean;
  webhookPublic: boolean;
  canPlaceLiveCall: boolean;
  banner: string | null;
};

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
  confirmationChannel?: ConfirmationChannel | null;
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
  shelters: Shelter[];
  shelterLabel: string;
  voice: VoiceStatus;
  voiceCalls: VoiceCallSummary[];
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
