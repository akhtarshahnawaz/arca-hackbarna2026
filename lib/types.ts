import type { ProtectiveAction } from "./protective-action";

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
  | "unanswered"
  | "busy"
  | "voicemail"
  | "hung_up"
  | "confirmed"
  | "unreachable"
  | "denied"
  | "stubbed";

export type VoiceCallSummary = {
  id: string;
  siteId: string;
  toLast4: string;
  status: VoiceCallStatus;
  uiStatus: "unanswered" | "busy" | "voicemail" | "hung up" | "confirmed" | "unreachable" | null;
  attempt: number;
  emptyHangup: boolean;
  flagged: boolean;
  transcript: string | null;
  selfCorrected: boolean;
  discardedCount: number | null;
  correctionCopy: string | null;
  nextRetryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactPolicyPublic = {
  dashboardLabel: string;
  approvalRequiredForAllContact: boolean;
  oneApproveCoversRetryPlan: boolean;
  retryPolicyCopy?: string;
  maxAttempts: number;
  hangupFollowUp: string;
  autoVetoEnabled: boolean;
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
  confirmationTranscript?: string | null;
  confirmationSelfCorrected?: boolean | null;
  confirmationDiscardedCount?: number | null;
  confirmationCorrectionCopy?: string | null;
  capacityUpdatedAt: string | null;
  source: "registry" | "resident" | "osm" | "demo";
  shelterHint: string;
  notes: string;
  /** Server seed only. Stripped from the command API. */
  phone?: string | null;
};

export type HourPolygon = {
  hour: number;
  member: number;
  ring: LonLat[];
};

export type RankedSite = SiteInput & {
  /** Display rank: position in the list the coordinator is looking at. */
  rank: number;
  /**
   * Rank by the clock alone — least spare time first — before the cross-check
   * re-sort. Broadcast copy has to speak for the site that is actually running
   * out of time, not for whichever site two satellites happen to agree about.
   */
  timeRank?: number;
  pReach: number;
  runsReach: number;
  ensembleMembers: number;
  tArrival: number | null;
  tEvac: number;
  spareTime: number | null;
  label: ReachLabel;
  arrivalHours: number[];
  /** Coordinator's protective action. Null means not chosen yet. */
  protectiveAction: ProtectiveAction | null;
  /** True when a number is on file from env. The digits are never sent to the browser. */
  phoneOnFile?: boolean;
  /** Set when two or more feeds see fire near this site. Null when only one does. */
  corroboration?: SiteCorroboration | null;
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

/** Which feed saw a fire at a point. "deepfire" is the primary feed. */
export type FireFeedId = "deepfire" | "firms" | "effis";

/** A detection from a cross-check feed, normalised to the Deepfire hotspot shape. */
export type FeedDetection = {
  id: string;
  feed: FireFeedId;
  lat: number;
  lon: number;
  observedAt: string | null;
  confidence: string | null;
};

/** A Deepfire hotspot after the cross-check pass. */
export type CheckedHotspot = Hotspot & {
  /** Feeds that saw fire at this point, "deepfire" always included. */
  confirmedBy: FireFeedId[];
  /** Distance to the nearest cross-feed detection, km. Null when nothing matched. */
  matchKm: number | null;
  /** Label of the static heat source this hotspot sits on, when it does. */
  staticHeat: string | null;
  /**
   * True when the chimney mask was read in full. False means "no chimney found"
   * could not be told apart from "the mask never loaded", so this hotspot is
   * never promoted: an empty mask must not corroborate every flare in Catalonia.
   */
  maskReady: boolean;
};

/** A known persistent thermal anomaly — a chimney, a quarry, a glasshouse. */
export type HeatSource = {
  id: string;
  label: string;
  type: string | null;
  remarks: string | null;
  source: string | null;
  year: number | null;
  lat: number;
  lon: number;
  /**
   * Outer ring per part: one for a Polygon, one each for a MultiPolygon. Every
   * part masks, and every part is drawn.
   */
  rings: LonLat[][];
};

/** How many independent feeds see fire near one site. */
export type SiteCorroboration = {
  /** Feeds that saw fire within the match radius, "deepfire" first. */
  feeds: FireFeedId[];
  /** Distance from the site to that hotspot, km. */
  km: number;
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
  /** From config/ranking-policy.json. Watch is fewer than this many reaching runs. */
  watchIfFewerThanRuns: number;
  hotspots: CheckedHotspot[];
  heatSources: HeatSource[];
  /**
   * Cross-feed detections near a hotspot or a listed site. Drawn, never ranked
   * on their own. Clipped before it leaves the server: the raw Catalonia box
   * runs to thousands of pixels in fire season, and all of them were being
   * serialised into the page and drawn as individual markers.
   */
  detections: FeedDetection[];
  sources: DataSourceStatus[];
  /** Notes that explain the demo. Safe to collapse. */
  banners: string[];
  /** Degraded inputs: a feed or the store failed. Always shown. */
  alerts: string[];
  shelters: Shelter[];
  shelterLabel: string;
  voice: VoiceStatus;
  voiceCalls: VoiceCallSummary[];
  contactPolicy: ContactPolicyPublic;
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
