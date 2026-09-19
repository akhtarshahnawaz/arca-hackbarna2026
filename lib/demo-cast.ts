/**
 * Sunday demo cast. Real phones and Telegram ids live in .env.local only.
 * Server-only — never NEXT_PUBLIC_. Unset → no phone / no invented mapping.
 */

export const DEMO_FARM_CODE = "REGA-B-1842";
export const DEMO_FARM_ID = "rega-b-1842";
export const DEMO_RESIDENT_SITE_CODE = "HH-PET-07";
export const DEMO_RESIDENT_SITE_ID = "hh-pet-07";

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/** Farmer phone on the demo farm. */
export function demoPhone(): string | null {
  return readEnv("DEMO_PHONE");
}

export function demoFarmerName(): string | null {
  return readEnv("DEMO_FARMER_NAME");
}

export function demoResidentTelegramChatId(): string | null {
  return readEnv("DEMO_RESIDENT_TELEGRAM_CHAT_ID");
}

export function demoResidentPhone(): string | null {
  return readEnv("DEMO_RESIDENT_PHONE");
}

export function demoResidentName(): string | null {
  return readEnv("DEMO_RESIDENT_NAME");
}

export function coordinatorTelegramChatId(): string | null {
  return readEnv("COORDINATOR_TELEGRAM_CHAT_ID");
}

export function coordinatorPhone(): string | null {
  return readEnv("COORDINATOR_PHONE");
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function phonesMatch(left: string, right: string): boolean {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  if (a.length < 8 || b.length < 8) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return longer.endsWith(shorter) && shorter.length >= 9;
}

export function phoneForSite(siteId: string): string | null {
  const query = siteId.trim().toLowerCase();
  if (!query) return null;
  if (query === DEMO_FARM_CODE.toLowerCase() || query === DEMO_FARM_ID) {
    return demoPhone();
  }
  if (query === DEMO_RESIDENT_SITE_CODE.toLowerCase() || query === DEMO_RESIDENT_SITE_ID) {
    return demoResidentPhone();
  }
  return null;
}

export function phoneOnFileFor(siteId: string): boolean {
  return Boolean(phoneForSite(siteId));
}
