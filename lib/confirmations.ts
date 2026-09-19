import type { ConfirmationStatus, SiteInput } from "./types";

export type ReportedConfirmation = {
  siteId: string;
  species: string;
  count: number;
  hasTransport: boolean | null;
  reportedAt: string;
  source: ConfirmationStatus;
};

export function speciesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function siteMatchesConfirmation(site: SiteInput, siteId: string): boolean {
  const needle = siteId.trim().toLowerCase();
  return site.id.toLowerCase() === needle || site.code.toLowerCase() === needle;
}

export function applyReportedConfirmations(
  sites: SiteInput[],
  confirmations: ReportedConfirmation[],
): SiteInput[] {
  const latest = new Map<string, ReportedConfirmation>();
  for (const row of confirmations) {
    const key = `${row.siteId.trim().toLowerCase()}::${row.species.trim().toLowerCase()}`;
    const prev = latest.get(key);
    if (!prev || prev.reportedAt < row.reportedAt) {
      latest.set(key, row);
    }
  }

  const rows = [...latest.values()];
  if (rows.length === 0) return sites;

  return sites.map((site) => {
    const matches = rows.filter((row) => siteMatchesConfirmation(site, row.siteId));
    if (matches.length === 0) return site;

    const animals = site.animals.map((animal) => {
      const hit = matches.find((row) => speciesMatch(row.species, animal.species));
      if (!hit) return animal;
      return { ...animal, confirmedCount: hit.count };
    });

    for (const hit of matches) {
      if (!animals.some((animal) => speciesMatch(hit.species, animal.species))) {
        animals.push({
          species: hit.species,
          registeredCapacity: null,
          confirmedCount: hit.count,
        });
      }
    }

    const transportRow = matches.find((row) => row.hasTransport !== null);
    const latestRow = matches.reduce((a, b) => (a.reportedAt > b.reportedAt ? a : b));
    const status: ConfirmationStatus = matches.every((row) => row.source === "verified")
      ? "verified"
      : "reported";

    return {
      ...site,
      animals,
      hasOwnTransport: transportRow ? transportRow.hasTransport : site.hasOwnTransport,
      confirmedAt: latestRow.reportedAt,
      confirmationStatus: status,
    };
  });
}
