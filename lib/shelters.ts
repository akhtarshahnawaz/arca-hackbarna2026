import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import seed from "@/config/shelters.json";
import { haversineKm } from "@/lib/geo";
import type { Shelter, ShelterConfig } from "@/lib/types";

const COORDINATOR_LABEL = "Configured by coordinator (not live data)";

function asConfig(value: unknown): ShelterConfig {
  const raw = value as Partial<ShelterConfig> | null;
  const shelters = Array.isArray(raw?.shelters)
    ? raw.shelters.filter(isShelter)
    : [];
  return {
    label: typeof raw?.label === "string" ? raw.label : COORDINATOR_LABEL,
    note:
      typeof raw?.note === "string"
        ? raw.note
        : "Edit config/shelters.json. This is not a live OSM protectora list.",
    shelters,
  };
}

function isShelter(value: unknown): value is Shelter {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Shelter>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.lat === "number" &&
    typeof row.lon === "number" &&
    typeof row.pets_allowed === "boolean"
  );
}

export function parseShelterConfig(value: unknown): ShelterConfig {
  return asConfig(value);
}

export function loadShelterConfig(): ShelterConfig {
  return asConfig(seed);
}

export function petShelters(config: ShelterConfig = loadShelterConfig()): Shelter[] {
  return config.shelters.filter((shelter) => shelter.pets_allowed);
}

export function nearestPetShelter(
  lat: number,
  lon: number,
  config: ShelterConfig = loadShelterConfig(),
): Shelter | null {
  const allowed = petShelters(config);
  if (allowed.length === 0) return null;
  return allowed.reduce((best, shelter) => {
    const bestKm = haversineKm({ lat, lon }, best);
    const nextKm = haversineKm({ lat, lon }, shelter);
    return nextKm < bestKm ? shelter : best;
  });
}

export function shelterHintForSite(
  lat: number,
  lon: number,
  config: ShelterConfig = loadShelterConfig(),
): string {
  const shelter = nearestPetShelter(lat, lon, config);
  if (!shelter) {
    return "No pet-accepting shelter in coordinator config. Edit config/shelters.json.";
  }
  const place = shelter.municipality ? ` · ${shelter.municipality}` : "";
  const notes = shelter.notes ? ` ${shelter.notes}` : "";
  return `${shelter.name}${place}.${notes} ${COORDINATOR_LABEL}.`;
}

export function applyConfiguredShelters<T extends { lat: number; lon: number; shelterHint: string }>(
  sites: T[],
  config: ShelterConfig = loadShelterConfig(),
): T[] {
  return sites.map((site) => ({
    ...site,
    shelterHint: shelterHintForSite(site.lat, site.lon, config),
  }));
}

export function sheltersFilePath(): string {
  return path.join(process.cwd(), "config", "shelters.json");
}

export async function readShelterConfigFromDisk(): Promise<ShelterConfig> {
  try {
    const raw = await readFile(sheltersFilePath(), "utf8");
    return asConfig(JSON.parse(raw));
  } catch {
    return loadShelterConfig();
  }
}

export async function writeShelterConfig(config: ShelterConfig): Promise<ShelterConfig> {
  const next = asConfig(config);
  if (next.shelters.length === 0) {
    throw new Error("Keep at least one shelter in the coordinator list.");
  }
  await mkdir(path.dirname(sheltersFilePath()), { recursive: true });
  await writeFile(sheltersFilePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function shelterSourceDetail(config: ShelterConfig = loadShelterConfig()): string {
  const dogs = petShelters(config).length;
  return `${COORDINATOR_LABEL}. ${dogs} pet-accepting site${dogs === 1 ? "" : "s"} in config/shelters.json. Not OSM protectoras.`;
}
