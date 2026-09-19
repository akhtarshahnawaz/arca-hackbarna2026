export type PhoneReport = {
  species: string | null;
  count: number | null;
  truck: boolean | null;
  canMoveNow: boolean | null;
  confidence: number;
  transcript: string;
  self_corrected: boolean;
  discardedCount: number | null;
  correctionCopy: string | null;
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  cero: 0,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  veinte: 20,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
  mil: 1000,
};

const CORRECTION =
  /\b(no|espera|perdón|perdon|perdona|digo|mejor|actually|wait|sorry|i mean|corrige|correction)\b/i;

const SPECIES: Array<{ species: string; pattern: RegExp }> = [
  { species: "sheep", pattern: /\b(sheep|oveja|ovejas|oví|ovi|cordero|corderos)\b/i },
  { species: "goats", pattern: /\b(goat|goats|cabra|cabras)\b/i },
  { species: "dogs", pattern: /\b(dog|dogs|perro|perros|gos|gossos)\b/i },
  { species: "horses", pattern: /\b(horse|horses|caballo|caballos|cavall|cavalls)\b/i },
  { species: "pigs", pattern: /\b(pig|pigs|cerdo|cerdos|porc|porcs)\b/i },
  { species: "cats", pattern: /\b(cat|cats|gato|gatos|gat|gats)\b/i },
];

export const LAST_CORRECTED_NUMBER_RULE =
  "If the speaker corrects a number, store the LAST corrected number. STT stays faithful: “doscientas… no, espera, trescientas ovejas” is 300, never 200.";

export function tokenizePhoneTranscript(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .replace(/[….,;:!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function wordNumber(token: string): number | null {
  const digits = token.replace(/[^\d]/g, "");
  if (digits && /^\d+$/.test(digits)) return Number(digits);
  return NUMBER_WORDS[token] ?? null;
}

/**
 * STT is faithful. The structured count must be the last correction.
 * “doscientas… no, espera, trescientas ovejas” → 300.
 */
export function extractLastCorrectedCount(transcript: string): number | null {
  const tokens = tokenizePhoneTranscript(transcript);
  let lastNumber: number | null = null;
  let lastAfterCorrection: number | null = null;
  let pendingCorrection = false;

  for (const token of tokens) {
    if (CORRECTION.test(token)) {
      pendingCorrection = true;
      continue;
    }
    const value = wordNumber(token);
    if (value === null) continue;
    lastNumber = value;
    if (pendingCorrection) {
      lastAfterCorrection = value;
      pendingCorrection = false;
    }
  }

  return lastAfterCorrection ?? lastNumber;
}

export function extractCorrectionEvidence(transcript: string): {
  count: number | null;
  discardedCount: number | null;
  self_corrected: boolean;
  correctionCopy: string | null;
} {
  const tokens = tokenizePhoneTranscript(transcript);
  const numbers: number[] = [];
  let sawCorrection = false;
  let lastAfterCorrection: number | null = null;
  let pendingCorrection = false;

  for (const token of tokens) {
    if (CORRECTION.test(token)) {
      sawCorrection = true;
      pendingCorrection = true;
      continue;
    }
    const value = wordNumber(token);
    if (value === null) continue;
    numbers.push(value);
    if (pendingCorrection) {
      lastAfterCorrection = value;
      pendingCorrection = false;
    }
  }

  const first = numbers[0] ?? null;
  const count = lastAfterCorrection ?? (numbers.length ? numbers[numbers.length - 1] : null);
  const self_corrected =
    sawCorrection && first !== null && count !== null && first !== count;
  const discardedCount = self_corrected ? first : null;
  return {
    count,
    discardedCount,
    self_corrected,
    correctionCopy: self_corrected
      ? `farmer said ${discardedCount}, corrected to ${count}, ARCA saved ${count}`
      : null,
  };
}

export function inferSpecies(transcript: string): string | null {
  for (const row of SPECIES) {
    if (row.pattern.test(transcript)) return row.species;
  }
  return null;
}

export function inferTruck(transcript: string): boolean | null {
  const text = transcript.toLowerCase();
  if (/\b(no (tengo |tenemos )?(camion|camión|truck|remolque)|sin camion|sin camión|no truck)\b/.test(text)) {
    return false;
  }
  if (/\b(camion|camión|truck|remolque|trailer|furgoneta)\b/.test(text)) return true;
  return null;
}

export function inferCanMoveNow(transcript: string): boolean | null {
  const text = transcript.toLowerCase();
  if (/\b(no (podemos )?salir|cannot move|can't move|no podemos movernos|todavia no|todavía no)\b/.test(text)) {
    return false;
  }
  if (/\b(podemos (salir|movernos)|can move|ready now|ya podemos|salimos ahora)\b/.test(text)) {
    return true;
  }
  return null;
}

export function parsePhoneReportFromTranscript(transcript: string): PhoneReport {
  const evidence = extractCorrectionEvidence(transcript);
  return {
    species: inferSpecies(transcript),
    count: evidence.count,
    truck: inferTruck(transcript),
    canMoveNow: inferCanMoveNow(transcript),
    confidence: evidence.count === null ? 0.2 : 0.7,
    transcript,
    self_corrected: evidence.self_corrected,
    discardedCount: evidence.discardedCount,
    correctionCopy: evidence.correctionCopy,
  };
}

export function applyLastCorrectedCount<T extends { count: number | null }>(
  report: T,
  transcript: string,
): T {
  const corrected = extractLastCorrectedCount(transcript);
  if (corrected === null) return report;
  return { ...report, count: corrected };
}

export function dtmfToReport(digits: string): PhoneReport {
  const cleaned = digits.replace(/[^\d]/g, "");
  const speciesCode = cleaned.slice(0, 1);
  const countRaw = cleaned.slice(1);
  const species =
    speciesCode === "1"
      ? "sheep"
      : speciesCode === "2"
        ? "goats"
        : speciesCode === "3"
          ? "dogs"
          : speciesCode === "4"
            ? "horses"
            : null;
  const count = countRaw ? Number(countRaw) : null;
  return {
    species,
    count: Number.isFinite(count) ? count : null,
    truck: null,
    canMoveNow: null,
    confidence: species && count ? 0.55 : 0.25,
    transcript: `DTMF ${cleaned || "(none)"}`,
    self_corrected: false,
    discardedCount: null,
    correctionCopy: null,
  };
}

export const PHONE_PARSE_PROMPT = [
  "Extract a JSON object with keys species, count, truck, canMoveNow, confidence.",
  "species is a lowercase English animal word or null.",
  "count is an integer or null.",
  "truck and canMoveNow are booleans or null.",
  "confidence is 0 to 1.",
  LAST_CORRECTED_NUMBER_RULE,
  "Also set self_corrected true and discardedCount to the number they abandoned.",
  "Do not invent a count that was not spoken.",
].join(" ");
