import {
  applyLastCorrectedCount,
  extractCorrectionEvidence,
  parsePhoneReportFromTranscript,
  PHONE_PARSE_PROMPT,
  type PhoneReport,
} from "@/lib/phone-report";
import {
  DEFAULT_NEBIUS_BASE_URL,
  DEFAULT_NEBIUS_MODEL,
  resolveNebiusBaseUrl,
  resolveNebiusModelId,
} from "../mastra/llm/nebius";

function asReport(value: unknown, transcript: string): PhoneReport | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PhoneReport>;
  const count = typeof row.count === "number" && Number.isFinite(row.count) ? Math.round(row.count) : null;
  const evidence = extractCorrectionEvidence(transcript);
  return {
    species: typeof row.species === "string" ? row.species : null,
    count,
    truck: typeof row.truck === "boolean" ? row.truck : null,
    canMoveNow: typeof row.canMoveNow === "boolean" ? row.canMoveNow : null,
    confidence: typeof row.confidence === "number" ? row.confidence : 0.5,
    transcript,
    self_corrected: evidence.self_corrected,
    discardedCount: evidence.discardedCount,
    correctionCopy: evidence.correctionCopy,
  };
}

export async function structurePhoneReport(transcript: string): Promise<PhoneReport> {
  const fallback = parsePhoneReportFromTranscript(transcript);
  const key = process.env.NEBIUS_API_KEY?.trim();
  if (!key || !transcript.trim()) {
    return fallback;
  }

  try {
    const response = await fetch(`${resolveNebiusBaseUrl() || DEFAULT_NEBIUS_BASE_URL}chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: resolveNebiusModelId() || DEFAULT_NEBIUS_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: PHONE_PARSE_PROMPT },
          { role: "user", content: transcript },
        ],
      }),
    });
    if (!response.ok) return fallback;
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    const parsed = match ? asReport(JSON.parse(match[0]), transcript) : null;
    if (!parsed) return fallback;
    const withCorrection = applyLastCorrectedCount(parsed, transcript);
    const evidence = extractCorrectionEvidence(transcript);
    return {
      ...withCorrection,
      species: withCorrection.species ?? fallback.species,
      truck: withCorrection.truck ?? fallback.truck,
      canMoveNow: withCorrection.canMoveNow ?? fallback.canMoveNow,
      transcript,
      self_corrected: evidence.self_corrected,
      discardedCount: evidence.discardedCount,
      correctionCopy: evidence.correctionCopy,
      count: evidence.count ?? withCorrection.count,
    };
  } catch {
    return fallback;
  }
}
