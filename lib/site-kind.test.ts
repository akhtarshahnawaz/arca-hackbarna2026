import { describe, expect, it } from "vitest";
import {
  siteKindBadgeClass,
  siteKindLabel,
  siteKindMarkerColor,
  siteKindSatelliteColor,
} from "@/lib/site-kind";
import type { SiteKind } from "@/lib/types";

const kinds: SiteKind[] = ["care_home", "hospital", "school", "farm", "household"];

describe("site kind colors", () => {
  it("labels every kind", () => {
    expect(siteKindLabel("care_home")).toBe("Care home");
    expect(siteKindLabel("hospital")).toBe("Hospital");
    expect(siteKindLabel("school")).toBe("School");
    expect(siteKindLabel("farm")).toBe("Farm");
    expect(siteKindLabel("household")).toBe("Household");
  });

  it("gives each kind a distinct filled badge class", () => {
    const classes = kinds.map((kind) => siteKindBadgeClass[kind]);
    expect(new Set(classes).size).toBe(kinds.length);
    for (const cls of classes) {
      expect(cls).toMatch(/bg-/);
      expect(cls).not.toMatch(/outline|border-border/);
    }
  });

  it("gives each kind a distinct map color", () => {
    const colors = kinds.map((kind) => siteKindMarkerColor[kind]);
    expect(new Set(colors).size).toBe(kinds.length);
  });

  it("gives each kind a distinct satellite color", () => {
    const colors = kinds.map((kind) => siteKindSatelliteColor[kind]);
    expect(new Set(colors).size).toBe(kinds.length);
    for (const kind of kinds) {
      expect(siteKindSatelliteColor[kind]).not.toBe(siteKindMarkerColor[kind]);
    }
  });
});
