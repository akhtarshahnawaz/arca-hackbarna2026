import { describe, expect, it } from "vitest";
import { ARCA_DISCLOSURE_LINE, arcaTransparencyLine, siteCallScript } from "@/lib/slng";

describe("ARCA disclosure line", () => {
  it("starts every site script with the fixed Sant Fruitós line", () => {
    expect(ARCA_DISCLOSURE_LINE).toBe(
      "This is ARCA, the automatic alert assistant for Sant Fruitós de Bages.",
    );
    expect(arcaTransparencyLine("Font-rubí")).toBe(ARCA_DISCLOSURE_LINE);
    expect(siteCallScript("anywhere").startsWith(ARCA_DISCLOSURE_LINE)).toBe(true);
  });
});
