import { describe, expect, it } from "vitest";
import { demoSites } from "@/lib/demo-data";
import {
  demoSiteAliases,
  looksLikePhoneId,
  matchKnownSite,
  PHONE_IS_NOT_A_SITE_REFUSAL,
  siteKeysMatch,
} from "@/lib/call-gate";
import { arcaMayCall } from "@/lib/protective-action";

describe("call gate", () => {
  it("treats a Spanish mobile as a phone, not a site id", () => {
    expect(looksLikePhoneId("633209158")).toBe(true);
    expect(looksLikePhoneId("+34633209158")).toBe(true);
    expect(looksLikePhoneId("REGA-B-1842")).toBe(false);
    expect(looksLikePhoneId("rega-b-1842")).toBe(false);
  });

  it("resolves REGA-B-1842 from seeded demo data only", () => {
    const site = matchKnownSite(demoSites(), "REGA-B-1842");
    expect(site?.code).toBe("REGA-B-1842");
    expect(site?.id).toBe("rega-b-1842");
    expect(site?.municipality).toBe("Sant Fruitós de Bages");
    expect("phone" in (site ?? {})).toBe(false);
    expect(matchKnownSite(demoSites(), "633209158")).toBeNull();
    expect(demoSiteAliases("rega-b-1842")).toEqual(["REGA-B-1842", "rega-b-1842"]);
  });

  it("matches saved decisions by code or id, case-insensitive", () => {
    expect(siteKeysMatch("REGA-B-1842", "rega-b-1842")).toBe(true);
    expect(arcaMayCall(null)).toBe(false);
    expect(arcaMayCall("monitor")).toBe(false);
    expect(arcaMayCall("confine")).toBe(true);
    expect(arcaMayCall("evacuate")).toBe(true);
  });

  it("keeps the phone-is-not-a-site refusal copy", () => {
    expect(PHONE_IS_NOT_A_SITE_REFUSAL).toMatch(/not a site id/i);
    expect(PHONE_IS_NOT_A_SITE_REFUSAL).toMatch(/no phones/i);
  });
});
