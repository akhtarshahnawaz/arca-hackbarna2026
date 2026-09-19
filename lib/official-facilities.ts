import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DataSourceStatus, SiteInput } from "./types";

const facilitySchema = z.object({
  id: z.string().min(1), code: z.string().min(1), name: z.string(),
  kind: z.enum(["school", "care_home", "hospital", "cap"]),
  municipality: z.string(), lon: z.number().min(0).max(3.5), lat: z.number().min(40.4).max(43),
  source: z.literal("registry"), phone: z.string().nullable().optional(),
  animals: z.array(z.never()), hasOwnTransport: z.null(), confirmedAt: z.null(),
  capacityUpdatedAt: z.null(), shelterHint: z.string(), notes: z.string(),
  facilityCapacity: z.number().int().nonnegative().nullable(),
  capacityUnit: z.enum(["students", "places", "beds"]).nullable(),
  capacityPeriod: z.string().nullable(),
  locationQuality: z.enum(["official_point", "address_geocoded", "municipality_centroid"]),
  datasetId: z.string(), sourceRecordId: z.string(), sourceUrl: z.string().url(),
  attribution: z.string(), capacitySourceUrl: z.string().url().optional(),
  capacityAttribution: z.string().optional(), locationAttribution: z.string().optional(),
  ccn: z.string().optional(), address: z.string(),
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), fetchedAt: z.string().datetime({ offset: true }),
  scope: z.string(), sites: z.array(facilitySchema),
  approximateLocations: z.number(), unlocated: z.array(z.unknown()),
  hospitalMatchReview: z.array(z.unknown()), hospitalError: z.string().nullable(),
  geocodingErrors: z.array(z.unknown()),
});

export function parseOfficialSnapshot(value: unknown) {
  const snapshot = snapshotSchema.parse(value);
  if (new Set(snapshot.sites.map(s => s.id)).size !== snapshot.sites.length) {
    throw new Error("Duplicate official facility IDs");
  }
  return snapshot;
}

export async function loadOfficialFacilities(): Promise<{ sites: SiteInput[]; status: DataSourceStatus }> {
  try {
    const snapshot = parseOfficialSnapshot(JSON.parse(await readFile(
      process.env.ARCA_OFFICIAL_DATA_PATH || path.join(process.cwd(), "data/official/facilities.json"), "utf8",
    )));
    const stale = Date.now() - Date.parse(snapshot.fetchedAt) > 8 * 24 * 60 * 60 * 1000;
    const gaps = snapshot.unlocated.length + snapshot.geocodingErrors.length;
    return {
      sites: snapshot.sites,
      status: {
        id: "official-facilities", label: "Official facilities · Generalitat / Sanidad",
        kind: "maybe_old", fetchedAt: snapshot.fetchedAt, ok: !stale && !snapshot.hospitalError && gaps === 0,
        detail: `${snapshot.sites.length} official facilities in ${snapshot.scope}. ${snapshot.approximateLocations} municipality locations excluded from fire-arrival estimates; ${snapshot.hospitalMatchReview.length} unmatched hospitals have unknown bed counts. ${gaps} unresolved records/errors. Capacity is not occupancy. Generalitat open licence; IGN/CartoCiudad CC BY 4.0; CNH: Ministerio de Sanidad.${stale ? " Snapshot older than 8 days; run npm run data:refresh." : ""}${snapshot.hospitalError ? " Hospital enrichment failed: " + snapshot.hospitalError : ""}`,
      },
    };
  } catch (error) {
    return { sites: [], status: {
      id: "official-facilities", label: "Official facilities", kind: "maybe_old", fetchedAt: null, ok: false,
      detail: `Official snapshot unavailable: ${error instanceof Error ? error.message : "invalid data"}. Run npm run data:refresh.`,
    } };
  }
}

export async function officialPhoneForSite(key: string): Promise<string | null> {
  const { sites } = await loadOfficialFacilities();
  const raw = sites.find(s => s.id === key || s.code === key)?.phone;
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return /^\d{9}$/.test(digits) ? `+34${digits}` : /^34\d{9}$/.test(digits) ? `+${digits}` : null;
}
