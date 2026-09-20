import {
  EXTRACTION_EXAMPLES,
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionPrompt,
  siteReportSchema,
  type RankedSite,
  type SiteReport,
} from "@arca/core";
import { nebius, type ChatMessage } from "../agent/nebius.js";
import { describeError } from "../logger.js";
import type { Context } from "../context.js";

/**
 * Transcript to structured report.
 *
 * The model's output is never trusted directly: it is parsed, validated against
 * the zod schema, and only then allowed anywhere near the ranking. A transcript
 * that cannot be parsed produces null, not a guess, because a fabricated
 * occupancy figure is worse than no figure — it would silently outrank a real
 * one and nobody would know which number they were acting on.
 */

const JSON_SCHEMA = {
  name: "site_report",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "peoplePresent", "nonAmbulatory", "vehicles", "needsHelp", "willFollowAction",
      "alreadyEvacuated", "livestockPresent", "corrections", "notes", "confidence",
    ],
    properties: {
      peoplePresent: { type: ["integer", "null"] },
      nonAmbulatory: { type: ["integer", "null"] },
      vehicles: { type: "array", items: { type: "string" } },
      needsHelp: { type: ["boolean", "null"] },
      willFollowAction: { type: ["boolean", "null"] },
      alreadyEvacuated: { type: ["boolean", "null"] },
      livestockPresent: { type: ["integer", "null"] },
      corrections: { type: "array", items: { type: "string" } },
      notes: { type: ["string", "null"] },
      confidence: { type: "number" },
    },
  },
};

export interface ExtractionOutcome {
  report: SiteReport | null;
  model: string | null;
  latencyMs: number | null;
  error: string | null;
}

export class ExtractionService {
  constructor(private readonly ctx: Context) {}

  async extract(input: {
    transcript: string;
    site: RankedSite;
    language?: string;
    source?: SiteReport["source"];
  }): Promise<ExtractionOutcome> {
    if (!input.transcript.trim()) {
      return { report: null, model: null, latencyMs: null, error: "Empty transcript." };
    }
    if (!nebius.configured) {
      return { report: null, model: null, latencyMs: null, error: "NEBIUS_API_KEY is not set." };
    }

    const messages: ChatMessage[] = [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      // Few-shot pairs, including the mid-sentence number correction that is
      // the single most common failure in spoken emergency reporting.
      ...EXTRACTION_EXAMPLES.flatMap((example): ChatMessage[] => [
        { role: "user", content: example.transcript },
        { role: "assistant", content: JSON.stringify(example.output) },
      ]),
      {
        role: "user",
        content: buildExtractionPrompt({
          siteName: input.site.name,
          siteType: input.site.subcategory,
          registeredPeople: input.site.capacity?.people ?? input.site.capacity?.places ?? null,
          transcript: input.transcript,
          language: input.language,
        }),
      },
    ];

    try {
      const result = await nebius.structured<unknown>(messages, JSON_SCHEMA, { temperature: 0 });
      const parsed = siteReportSchema.safeParse(result.content);

      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : "schema mismatch";
        return {
          report: null,
          model: result.model,
          latencyMs: result.latencyMs,
          error: `Extraction did not match the schema (${detail}).`,
        };
      }

      const report: SiteReport = {
        ...parsed.data,
        capturedAt: new Date().toISOString(),
        source: input.source ?? "phone",
      };
      return { report, model: result.model, latencyMs: result.latencyMs, error: null };
    } catch (error) {
      const message = describeError(error);
      this.ctx.log.error("Extraction failed", { error: message, site: input.site.name });
      return { report: null, model: null, latencyMs: null, error: message };
    }
  }

  /** A one-line summary of what a site said, for the timeline and Telegram. */
  static describe(report: SiteReport, siteName: string): string {
    const parts: string[] = [];
    if (report.peoplePresent !== null) parts.push(`${report.peoplePresent} people present`);
    if (report.nonAmbulatory) parts.push(`${report.nonAmbulatory} unable to walk unaided`);
    if (report.livestockPresent !== null) parts.push(`${report.livestockPresent} animals`);
    if (report.vehicles.length > 0) parts.push(`vehicles: ${report.vehicles.join(", ")}`);
    if (report.needsHelp) parts.push("asked for help");
    if (report.alreadyEvacuated) parts.push("already evacuated");
    const body = parts.length > 0 ? parts.join("; ") : "nothing new reported";
    const corrections =
      report.corrections.length > 0 ? ` Corrections: ${report.corrections.join(" ")}` : "";
    const caveat = report.confidence < 0.5 ? " Treat as unconfirmed: the line was unclear." : "";
    return `${siteName} reported ${body}.${corrections}${caveat}`;
  }
}
