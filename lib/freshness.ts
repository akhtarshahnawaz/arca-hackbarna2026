import type { ConfirmationChannel, ConfirmationStatus, FreshnessKind } from "@/lib/types";

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

export function confirmedCopy(
  confirmedAt: string | null,
  status?: ConfirmationStatus | null,
  channel?: ConfirmationChannel | null,
): string {
  if (!confirmedAt) return "Ask how many are there now — log as reported, not verified";
  if (status === "verified") {
    return `Verified today ${formatClock(confirmedAt)}`;
  }
  if (channel === "phone") {
    return `Reported by phone (not verified) ${formatClock(confirmedAt)}`;
  }
  if (channel === "telegram") {
    return `Reported by Telegram voice (not verified) ${formatClock(confirmedAt)}`;
  }
  return `Reported (not verified) ${formatClock(confirmedAt)}`;
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
