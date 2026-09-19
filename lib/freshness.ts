import type { FreshnessKind } from "@/lib/types";

export function formatClock(iso: string | null, timeZone = "Europe/Madrid"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    hour12: false,
  }).format(date);
}

export function formatDay(iso: string | null, timeZone = "Europe/Madrid"): string {
  if (!iso) return "unknown date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(date);
}

export function confirmedCopy(confirmedAt: string | null): string {
  if (!confirmedAt) return "Ask to confirm how many are there now";
  return `Confirmed today ${formatClock(confirmedAt)}`;
}

export function registeredCopy(updatedAt: string | null): string {
  if (!updatedAt) return "Registered (may be outdated)";
  return `Registered (may be outdated) · capacity dated ${formatDay(updatedAt)}`;
}

export function freshnessLabel(kind: FreshnessKind): string {
  if (kind === "live") return "Live";
  if (kind === "demo") return "Demo";
  return "Maybe old";
}
