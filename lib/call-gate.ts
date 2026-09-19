import { phonesMatch } from "./demo-cast";
import { demoSites } from "./demo-data";
import { listProtectiveActions } from "./db";
import { arcaMayCall, type ProtectiveAction } from "./protective-action";

export const NO_DECISION_CALL_REFUSAL =
  "REFUSED: Call stays off until Confine or Evacuate is saved for this site. Red is urgency, not an order to leave.";

export const UNKNOWN_SITE_REFUSAL =
  "REFUSED: That site is not in the ranked list or saved decisions. Lookup is data-backed only.";

export const PHONE_IS_NOT_A_SITE_REFUSAL =
  "REFUSED: That number is not on file for a seeded site. A phone is not a site id unless it matches DEMO_PHONE or another env-backed site phone.";

export function looksLikePhoneId(value: string): boolean {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  return /^\+?[\d\s().-]+$/.test(trimmed);
}

export function siteKeysMatch(saved: string, query: string): boolean {
  return saved.trim().toLowerCase() === query.trim().toLowerCase();
}

export function matchKnownSite<T extends { id: string; code: string; phone?: string | null }>(
  sites: T[],
  siteId: string,
): T | null {
  const query = siteId.trim();
  if (!query) return null;
  if (looksLikePhoneId(query)) {
    return sites.find((site) => Boolean(site.phone) && phonesMatch(site.phone ?? "", query)) ?? null;
  }
  const needle = query.toLowerCase();
  return (
    sites.find((site) => site.id.toLowerCase() === needle || site.code.toLowerCase() === needle) ??
    null
  );
}

export function demoSiteAliases(siteId: string): string[] {
  const site = matchKnownSite(demoSites(), siteId);
  if (!site) return siteId.trim() ? [siteId.trim()] : [];
  return [site.code, site.id];
}

export type CallPermission =
  | { ok: true; siteId: string; action: "confine" | "evacuate" }
  | { ok: false; refused: true; reason: string; action: ProtectiveAction | null };

export async function resolveCallPermission(siteId: string): Promise<CallPermission> {
  const raw = siteId.trim();
  if (!raw) {
    return { ok: false, refused: true, reason: UNKNOWN_SITE_REFUSAL, action: null };
  }

  const known = matchKnownSite(demoSites(), raw);
  if (looksLikePhoneId(raw) && !known) {
    return { ok: false, refused: true, reason: PHONE_IS_NOT_A_SITE_REFUSAL, action: null };
  }

  const chosen = await listProtectiveActions();
  const aliases = demoSiteAliases(known?.code ?? raw);
  let action: ProtectiveAction | null = null;
  let canonical = aliases[0] ?? raw;

  for (const key of aliases) {
    const hit = chosen.get(key);
    if (hit) {
      action = hit;
      canonical = key;
      break;
    }
  }

  if (!action) {
    for (const [key, value] of chosen) {
      if (aliases.some((alias) => siteKeysMatch(key, alias)) || siteKeysMatch(key, raw)) {
        action = value;
        canonical = key;
        break;
      }
    }
  }

  if (action === "confine" || action === "evacuate") {
    return { ok: true, siteId: canonical, action };
  }

  return { ok: false, refused: true, reason: NO_DECISION_CALL_REFUSAL, action };
}

export function mayCallFromPermission(permission: CallPermission): boolean {
  return permission.ok && arcaMayCall(permission.action);
}
