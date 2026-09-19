import { describe, expect, it } from "vitest";
import {
  afterLookupChoices,
  afterRequestChoices,
  briefingChoices,
  CTA_PROMPT,
  formatCta,
} from "@/lib/coordinator-cta";

describe("coordinator CTA", () => {
  it("lists explicit choices and forbids a free-text call question", () => {
    const cta = formatCta(briefingChoices());
    expect(cta.prompt).toBe(CTA_PROMPT);
    expect(cta.choices.every((choice) => !/Would you like to/i.test(choice.label))).toBe(true);
    expect(cta.choices.map((choice) => choice.id)).toEqual([
      "lookup_site",
      "set_confine",
      "set_evacuate",
      "request_call",
      "log_report",
    ]);
    expect(cta.choiceList).toMatch(/1\. Look up a site/);
    expect(cta.choiceList).toMatch(/typing Call is not approval/i);
  });

  it("locks call choices until Confine or Evacuate", () => {
    expect(afterLookupChoices(false).map((choice) => choice.id)).toEqual([
      "set_confine",
      "set_evacuate",
      "lookup_site",
    ]);
    expect(afterLookupChoices(true).some((choice) => choice.id === "request_call")).toBe(true);
    expect(afterRequestChoices()[0].label).toMatch(/Approve/);
  });
});
