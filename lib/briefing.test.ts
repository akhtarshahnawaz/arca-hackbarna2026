import { describe, expect, it } from "vitest";
import { formatResidentAlert } from "@/lib/briefing";

describe("resident alert", () => {
  it("tells people to stay inside and bring dogs in", () => {
    const text = formatResidentAlert({
      fireWindow: "In 7 of 10 runs, fire reaches within 3 h",
      shelterHint: "PAV-ESP-03",
      municipality: "Sant Fruitós de Bages",
    });
    expect(text).toMatch(/stay inside/i);
    expect(text).toMatch(/dogs/i);
    expect(text).toMatch(/close doors/i);
  });
});
