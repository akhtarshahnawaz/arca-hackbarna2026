import { describe, expect, it } from "vitest";
import { extractCorrectionEvidence, parsePhoneReportFromTranscript } from "@/lib/phone-report";

describe("last-corrected number", () => {
  it("saves 300 and keeps 200 visible when the farmer self-corrects", () => {
    const transcript = "doscientas… no, espera, trescientas ovejas";
    const report = parsePhoneReportFromTranscript(transcript);
    const evidence = extractCorrectionEvidence(transcript);

    expect(report.count).toBe(300);
    expect(report.species).toBe("sheep");
    expect(report.transcript).toBe(transcript);
    expect(report.self_corrected).toBe(true);
    expect(report.discardedCount).toBe(200);
    expect(report.correctionCopy).toBe("farmer said 200, corrected to 300, ARCA saved 300");
    expect(evidence.self_corrected).toBe(true);
  });

  it("does not mark a single number as a correction", () => {
    const report = parsePhoneReportFromTranscript("trescientas ovejas");
    expect(report.count).toBe(300);
    expect(report.self_corrected).toBe(false);
    expect(report.discardedCount).toBeNull();
  });
});
