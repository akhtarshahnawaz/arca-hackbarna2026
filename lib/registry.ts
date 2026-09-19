import type { SiteInput } from "@/lib/types";

type RegistryRow = {
  codi_rega?: string;
  municipi?: string;
  comarca?: string;
  latitud?: string;
  longitud?: string;
  esp_cie?: string;
  cap_n_m_total_animals?: string | number;
  data_actualitzaci_capacitat?: string;
  estat_explotaci_?: string;
};

export type RegistryStatus = {
  ok: boolean;
  detail: string;
  sites: SiteInput[];
  fetchedAt: string | null;
};

function sodaUrl() {
  return (
    process.env.CATALUNYA_FARMS_SODA_URL ??
    "https://analisi.transparenciacatalunya.cat/resource/7bpt-5azk.json"
  );
}

function parseCoord(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dms = trimmed.match(/(-?[\d.]+)\s*[º°]\s*([\d.]+)'\s*([\d.]+)''/);
  if (dms) {
    const deg = Number(dms[1]);
    const min = Number(dms[2]);
    const sec = Number(dms[3]);
    const sign = deg < 0 || trimmed.includes("S") || trimmed.includes("W") ? -1 : 1;
    const decimal = Math.abs(deg) + min / 60 + sec / 3600;
    return sign * decimal;
  }
  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseCapacity(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function speciesEnglish(value: string | undefined): string {
  const raw = (value ?? "livestock").toLowerCase();
  if (raw.includes("oví") || raw.includes("ovi") || raw.includes("sheep")) return "sheep";
  if (raw.includes("cabra") || raw.includes("goat")) return "goats";
  if (raw.includes("porc") || raw.includes("pig")) return "pigs";
  if (raw.includes("equ") || raw.includes("cavall") || raw.includes("horse")) return "horses";
  if (raw.includes("bov") || raw.includes("vac") || raw.includes("cow")) return "cattle";
  if (raw.includes("conill") || raw.includes("rabbit")) return "rabbits";
  return value?.trim() || "livestock";
}

function nearBages(lon: number, lat: number) {
  return lon >= 1.48 && lon <= 2.12 && lat >= 41.58 && lat <= 42.0;
}

export async function fetchRegistryFarms(): Promise<RegistryStatus> {
  const params = new URLSearchParams({
    $select:
      "codi_rega,municipi,comarca,latitud,longitud,esp_cie,cap_n_m_total_animals,data_actualitzaci_capacitat,estat_explotaci_",
    $where: "latitud IS NOT NULL AND longitud IS NOT NULL AND comarca = 'Bages'",
    $order: "cap_n_m_total_animals DESC",
    $limit: "200",
  });

  try {
    const response = await fetch(`${sodaUrl()}?${params}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return {
        ok: false,
        detail: `Livestock registry failed (${response.status}). Using seeded farms.`,
        sites: [],
        fetchedAt: null,
      };
    }

    const rows = (await response.json()) as RegistryRow[];
    const seen = new Set<string>();
    const sites: SiteInput[] = [];

    for (const row of rows) {
      const lon = parseCoord(row.longitud);
      const lat = parseCoord(row.latitud);
      if (lon === null || lat === null) continue;
      if (!nearBages(lon, lat)) continue;
      const code = row.codi_rega?.trim();
      if (!code || seen.has(code)) continue;
      seen.add(code);

      sites.push({
        id: `rega-${code}`,
        code: `REGA-${code.slice(-4)}`,
        kind: "farm",
        municipality: row.municipi?.trim() || "Bages",
        lon,
        lat,
        animals: [
          {
            species: speciesEnglish(row.esp_cie),
            registeredCapacity: parseCapacity(row.cap_n_m_total_animals),
            confirmedCount: null,
          },
        ],
        hasOwnTransport: null,
        confirmedAt: null,
        capacityUpdatedAt: row.data_actualitzaci_capacitat ?? null,
        source: "registry",
        shelterHint: "POL-REC-08 Recinte Firal Manresa — confirm the species is accepted.",
        notes: "Official capacity only. Ask how many animals are present today.",
      });
    }

    sites.sort((a, b) => (b.animals[0]?.registeredCapacity ?? 0) - (a.animals[0]?.registeredCapacity ?? 0));
    const withCapacity = sites.filter((site) => (site.animals[0]?.registeredCapacity ?? 0) > 0);
    const picked = (withCapacity.length > 0 ? withCapacity : sites).slice(0, 4);

    return {
      ok: true,
      detail:
        picked.length === 0
          ? "Registry reachable. No parseable Bages coordinates in this pull."
          : `Registry reachable. ${picked.length} extra Bages farm${picked.length === 1 ? "" : "s"} added from 7bpt-5azk.`,
      sites: picked,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      ok: false,
      detail: `Livestock registry unreachable (${message}). Using seeded farms.`,
      sites: [],
      fetchedAt: null,
    };
  }
}
