/**
 * CQL2-text builders.
 *
 * DeepFire's filter language is close enough to SQL to invite string
 * concatenation and different enough to punish it: timestamps need the
 * TIMESTAMP() wrapper, strings need single quotes, and a bare bbox with a large
 * limit is the one query shape that reliably blows the 30-second budget. These
 * helpers make the safe query the easy one.
 */

export function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function timestamp(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return `TIMESTAMP(${quote(iso)})`;
}

export function and(...clauses: Array<string | null | undefined | false>): string {
  const kept = clauses.filter((c): c is string => Boolean(c));
  return kept.length > 1 ? kept.map((c) => `(${c})`).join(" AND ") : (kept[0] ?? "");
}

export function or(...clauses: Array<string | null | undefined | false>): string {
  const kept = clauses.filter((c): c is string => Boolean(c));
  return kept.length > 1 ? kept.map((c) => `(${c})`).join(" OR ") : (kept[0] ?? "");
}

export function inList(field: string, values: string[]): string {
  if (values.length === 0) return "1 = 0";
  return `${field} IN (${values.map(quote).join(", ")})`;
}

export function since(field: string, isoOrDate: string | Date): string {
  return `${field} >= ${timestamp(isoOrDate)}`;
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

/** Clusters worth looking at: live, and touched inside the lookback window. */
export function activeClustersRecent(hours: number): string {
  return and("active = true", since("last_observed", hoursAgo(hours)));
}

/** Every hotspot belonging to a set of clusters. */
export function hotspotsForClusters(clusterIds: string[]): string {
  return inList("cluster_id", clusterIds);
}

/** Historical window for replay bundles, where `active` is already false. */
export function clustersInWindow(from: string | Date, to: string | Date): string {
  return and(
    `last_observed >= ${timestamp(from)}`,
    `first_observed <= ${timestamp(to)}`,
  );
}
