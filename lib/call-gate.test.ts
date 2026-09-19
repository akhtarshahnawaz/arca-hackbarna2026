import { afterEach, describe, expect, it } from "vitest";
import { demoSites } from "@/lib/demo-data";
import {
  demoSiteAliases,
  looksLikePhoneId,
  matchKnownSite,
  PHONE_IS_NOT_A_SITE_REFUSAL,
  siteKeysMatch,
} from "@/lib/call-gate";
import { arcaMayCall } from "@/lib/protective-action";

const SAMPLE_MOBILE = "600000000";
const SAMPLE_E164 = "+34600000000";

afterEach(() => {
  delete process.env.DEMO_PHONE;
});

describe("call gate", () => {
  it("treats a Spanish mobile as a phone, not a site id", () => {
    expect(looksLikePhoneId(SAMPLE_MOBILE)).toBe(true);
    expect(looksLikePhoneId(SAMPLE_E164)).toBe(true);
    expect(looksLikePhoneId("REGA-B-1842")).toBe(false);
    expect(looksLikePhoneId("rega-b-1842")).toBe(false);
  });

  it("resolves REGA-B-1842 from seeded demo data only", () => {
    const site = matchKnownSite(demoSites(), "REGA-B-1842");
    expect(site?.code).toBe("REGA-B-1842");
    expect(site?.id).toBe("rega-b-1842");
    expect(site?.municipality).toBe("Sant Fruitós de Bages");
    expect(site?.phone ?? null).toBeNull();
    expect(matchKnownSite(demoSites(), SAMPLE_MOBILE)).toBeNull();
    expect(demoSiteAliases("rega-b-1842")).toEqual(["REGA-B-1842", "rega-b-1842"]);
  });

  it("maps DEMO_PHONE to the demo farm when set, and invents nothing when unset", () => {
    process.env.DEMO_PHONE = "600111222";
    const hit = matchKnownSite(demoSites(), "600111222");
    expect(hit?.code).toBe("REGA-B-1842");
    delete process.env.DEMO_PHONE;
    expect(matchKnownSite(demoSites(), "600111222")).toBeNull();
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
    expect(PHONE_IS_NOT_A_SITE_REFUSAL).toMatch(/not on file/i);
  });
});
