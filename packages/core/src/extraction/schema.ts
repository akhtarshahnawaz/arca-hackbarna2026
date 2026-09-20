import { z } from "zod";

/**
 * What a phone call is allowed to change.
 *
 * The schema is narrow on purpose. A voice agent that can write arbitrary text
 * into an incident record is a voice agent that can invent an evacuation. These
 * are the only facts a site can report, each one nullable, because "they did not
 * say" and "they said zero" are different answers and conflating them would put
 * an empty school at the top of the list.
 */
export const siteReportSchema = z.object({
  peoplePresent: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .nullable()
    .describe("People physically at the site right now. Null if not stated."),
  nonAmbulatory: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .nullable()
    .describe("How many cannot walk unaided. Null if not stated."),
  vehicles: z
    .array(z.string().max(120))
    .max(20)
    .describe("Vehicles available on site, as described. Empty array if none mentioned."),
  needsHelp: z
    .boolean()
    .nullable()
    .describe("True if they asked for help evacuating. Null if not discussed."),
  willFollowAction: z
    .boolean()
    .nullable()
    .describe("True if they agreed to the recommended action. Null if unclear."),
  alreadyEvacuated: z
    .boolean()
    .nullable()
    .describe("True if the site is already empty. Null if not stated."),
  livestockPresent: z
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .nullable()
    .describe("Animals on site now, if a farm. Null if not stated."),
  corrections: z
    .array(z.string().max(300))
    .max(10)
    .describe(
      "Every figure the speaker revised, as 'said X then corrected to Y'. The later number is the one used.",
    ),
  notes: z
    .string()
    .max(600)
    .nullable()
    .describe("Anything else a coordinator must know, in one or two sentences."),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How clearly the transcript supports these values. Below 0.5 means treat as unconfirmed."),
});

export type SiteReportExtraction = z.infer<typeof siteReportSchema>;

/**
 * The extraction prompt.
 *
 * The number-correction rule is first because it is the one that broke the
 * previous build: a farmer saying "doscientas... no, trescientas" was stored as
 * 200, and a ranked list built on it sent help for the wrong number of animals.
 * Spoken numbers get revised mid-sentence far more often than written ones.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from a transcript of an emergency phone call to a site threatened by wildfire.

Rules, in order of importance:
1. When a speaker corrects a number, keep the LAST value they stated and record the change in "corrections". "Doscientas, no, trescientas" is 300, with a correction noting 200 was said first.
2. Only record what was actually said. If a field was not discussed, it is null. Never infer occupancy from the type of building.
3. "Zero" and "not stated" are different. Zero is 0; not stated is null.
4. Numbers spoken as words become digits. Ranges ("thirty or forty") take the higher value and are noted in "corrections".
5. Set "confidence" low when the line was poor, the answer was vague, or the speaker seemed unsure.
6. Write "notes" for a coordinator reading it in five seconds. No speculation, no advice.

You return JSON only.`;

export function buildExtractionPrompt(input: {
  siteName: string;
  siteType: string;
  registeredPeople: number | null;
  transcript: string;
  language?: string;
}): string {
  return [
    `Site: ${input.siteName} (${input.siteType.replace(/_/g, " ")})`,
    input.registeredPeople !== null
      ? `Registered capacity on file: ${input.registeredPeople}. This is a maximum, not an occupancy. Do not copy it into peoplePresent unless the speaker confirmed it.`
      : "No registered capacity on file.",
    input.language ? `Call language: ${input.language}.` : "",
    "",
    "Transcript:",
    input.transcript.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Few-shot examples, including the correction case that matters most. */
export const EXTRACTION_EXAMPLES: Array<{ transcript: string; output: SiteReportExtraction }> = [
  {
    transcript:
      "Agent: ¿Cuántas personas hay ahora mismo?\nSite: Pues ahora mismo somos treinta y ocho residentes, y seis del personal.\nAgent: ¿Cuántas no pueden caminar sin ayuda?\nSite: Doce, doce en silla de ruedas.\nAgent: ¿Qué vehículos tienen?\nSite: Tenemos una furgoneta de nueve plazas, nada más.\nAgent: ¿Necesitan ayuda para evacuar?\nSite: Sí, sí, necesitamos ambulancias, no podemos con doce en silla.",
    output: {
      peoplePresent: 44,
      nonAmbulatory: 12,
      vehicles: ["9-seat van"],
      needsHelp: true,
      willFollowAction: null,
      alreadyEvacuated: null,
      livestockPresent: null,
      corrections: [],
      notes: "38 residents plus 6 staff. Twelve wheelchair users; one 9-seat van is not enough. Asked for ambulances.",
      confidence: 0.9,
    },
  },
  {
    transcript:
      "Agent: ¿Cuántos animales tiene ahora en la explotación?\nSite: Doscientas ovejas... no, espera, trescientas. Metimos cien la semana pasada.\nAgent: ¿Tiene camión?\nSite: No, el camión se lo llevó mi hijo a Lleida.",
    output: {
      peoplePresent: null,
      nonAmbulatory: null,
      vehicles: [],
      needsHelp: null,
      willFollowAction: null,
      alreadyEvacuated: null,
      livestockPresent: 300,
      corrections: ["Said 200 sheep, then corrected to 300 after recalling 100 added last week."],
      notes: "300 sheep on site and no truck available — the farm's truck is in Lleida. Livestock transport needed.",
      confidence: 0.85,
    },
  },
];
