import { afterEach, describe, expect, it } from "vitest";
import { demoSites } from "@/lib/demo-data";
import { phoneForSite, phonesMatch } from "@/lib/demo-cast";

afterEach(() => {
  delete process.env.DEMO_PHONE;
  delete process.env.DEMO_RESIDENT_PHONE;
});

describe("demo cast env", () => {
  it("attaches env phones to the demo farm and household only", () => {
    process.env.DEMO_PHONE = "600111222";
    process.env.DEMO_RESIDENT_PHONE = "600333444";
    const farm = demoSites().find((site) => site.code === "REGA-B-1842");
    const house = demoSites().find((site) => site.code === "HH-PET-07");
    expect(farm?.phone).toBe("600111222");
    expect(house?.phone).toBe("600333444");
    expect(phoneForSite("REGA-B-1842")).toBe("600111222");
    expect(phonesMatch("600111222", "+34600111222")).toBe(true);
  });

  it("leaves phones null when env is unset", () => {
    expect(phoneForSite("REGA-B-1842")).toBeNull();
    expect(demoSites().every((site) => !site.phone)).toBe(true);
  });
});
