import { describe, expect, it } from "vitest";
import snapshot from "../data/official/facilities.json";
import { parseOfficialSnapshot, loadOfficialFacilities, officialPhoneForSite } from "./official-facilities";
import { arrivalHoursForSite } from "./ranking";

describe("official facilities", () => {
  it("validates the imported snapshot, coordinates and unique IDs", () => {
    const parsed = parseOfficialSnapshot(snapshot);
    expect(parsed.sites.length).toBeGreaterThan(0);
    expect(() => parseOfficialSnapshot({ ...snapshot, sites: [snapshot.sites[0], snapshot.sites[0]] })).toThrow("Duplicate");
    expect(() => parseOfficialSnapshot({ ...snapshot, sites: [{ ...snapshot.sites[0], lat: 900 }] })).toThrow();
  });
  it("never uses a municipality centroid as a facility fire intersection", async () => {
    const { sites } = await loadOfficialFacilities();
    const site = sites[0];
    const polygons = [{ member: 0, hour: 1, ring: [[0,40],[4,40],[4,43],[0,43]] as [number,number][] }];
    expect(arrivalHoursForSite(site, polygons, 1, 6)).toEqual([1]);
    expect(arrivalHoursForSite({ ...site, locationQuality: "municipality_centroid" }, polygons, 1, 6)).toEqual([]);
  });
  it("resolves institutional numbers by stable id without disclosing them in metadata", async () => {
    const { sites } = await loadOfficialFacilities();
    const site = sites.find(s => s.phone?.replace(/\D/g, "").length === 9)!;
    expect(await officialPhoneForSite(site.id)).toMatch(/^\+34\d{9}$/);
    expect(await officialPhoneForSite("unknown")).toBeNull();
  });
});
