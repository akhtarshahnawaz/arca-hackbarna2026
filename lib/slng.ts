import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { slngConfigured } from "./voice-status";

/**
 * SLNG Voice adapters (docs.slng.ai).
 * Auth: Authorization: Bearer SLNG_API_KEY
 * TTS: POST /v1/tts/slng/deepgram/aura:2-en  { model, text, encoding: "mp3" }
 * STT: POST /v1/stt/slng/deepgram/nova:3-multi  multipart audio or { url }
 * Default gateway: eu-west (GDPR / Barcelona residency preference).
 * Official Aura 2 SLNG-hosted catalog also lists us-east / us-west — override
 * with code default only; do not invent a key.
 */
export const SLNG_DEFAULT_BASE_URL = "https://eu-west.api.slng.ai";
export const SLNG_TTS_PATH = "/v1/tts/slng/deepgram/aura:2-en";
export const SLNG_STT_PATH = "/v1/stt/slng/deepgram/nova:3-multi";
export const SLNG_TTS_MODEL = "aura-2-thalia-en";

export type SlngKind = "tts" | "stt";

export type SlngLog = {
  started_at: string;
  latency_ms: number;
  kind: SlngKind;
  ok: boolean;
  fallback: boolean;
  cost?: string;
  quality?: string;
  detail: string;
};

export type TtsResult = {
  audioId: string;
  mimeType: string;
  bytes: Buffer;
  text: string;
  fallback: boolean;
  log: SlngLog;
};

export type SttResult = {
  transcript: string;
  confidence: number | null;
  fallback: boolean;
  log: SlngLog;
};

type SlngSink = {
  persistLog?: (log: SlngLog) => Promise<void>;
};

let sink: SlngSink = {};

export function setSlngSink(next: SlngSink) {
  sink = next;
}

export function slngBaseUrl(): string {
  return SLNG_DEFAULT_BASE_URL;
}

function logSlng(log: SlngLog) {
  console.info("ARCA SLNG", log);
  void sink.persistLog?.(log);
}

function audioDir() {
  return path.join(process.cwd(), ".arca-audio");
}

export async function writeAudioFile(bytes: Buffer, ext = "mp3"): Promise<string> {
  const audioId = randomUUID();
  await mkdir(audioDir(), { recursive: true });
  await writeFile(path.join(audioDir(), `${audioId}.${ext}`), bytes);
  return audioId;
}

export function audioFilePath(audioId: string, ext = "mp3"): string {
  return path.join(audioDir(), `${audioId}.${ext}`);
}

/** Tiny valid-enough MP3 frame so Vonage stream / Telegram have a file in stub mode. */
export function mockMp3Bytes(): Buffer {
  return Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

export const ARCA_DISCLOSURE_LINE =
  "This is ARCA, the evacuation-planning assistant for civil-protection coordinators in Sant Fruitós de Bages.";

export function arcaTransparencyLine(_town?: string): string {
  return ARCA_DISCLOSURE_LINE;
}

export function siteCallScript(town: string): string {
  return [
    arcaTransparencyLine(town),
    "After the beep, say how many animals are with you now, whether you have a truck, and if you can move now.",
    "If speech fails, press 1 for sheep, 2 for goats, 3 for dogs, 4 for horses, then the count and hash.",
  ].join(" ");
}

export function dtmfPromptScript(town: string): string {
  return [
    arcaTransparencyLine(town),
    "We did not catch the speech. Press 1 for sheep, 2 for goats, 3 for dogs, 4 for horses, then the count and hash.",
  ].join(" ");
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  const started_at = new Date().toISOString();
  const t0 = Date.now();
  const key = process.env.SLNG_API_KEY?.trim();

  if (!key) {
    const bytes = mockMp3Bytes();
    const audioId = await writeAudioFile(bytes);
    const log: SlngLog = {
      started_at,
      latency_ms: Date.now() - t0,
      kind: "tts",
      ok: false,
      fallback: true,
      detail: "SLNG_API_KEY unset — mock mp3",
    };
    logSlng(log);
    return { audioId, mimeType: "audio/mpeg", bytes, text, fallback: true, log };
  }

  try {
    const response = await fetch(`${slngBaseUrl()}${SLNG_TTS_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SLNG_TTS_MODEL,
        text,
        encoding: "mp3",
      }),
    });
    if (!response.ok) {
      throw new Error(`SLNG TTS ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const audioId = await writeAudioFile(bytes);
    const log: SlngLog = {
      started_at,
      latency_ms: Date.now() - t0,
      kind: "tts",
      ok: true,
      fallback: false,
      quality: response.headers.get("x-slng-quality") ?? undefined,
      cost: response.headers.get("x-slng-cost") ?? undefined,
      detail: `tts ${bytes.length} bytes`,
    };
    logSlng(log);
    return { audioId, mimeType: "audio/mpeg", bytes, text, fallback: false, log };
  } catch (error) {
    const message = error instanceof Error ? error.message : "tts failed";
    const bytes = mockMp3Bytes();
    const audioId = await writeAudioFile(bytes);
    const log: SlngLog = {
      started_at,
      latency_ms: Date.now() - t0,
      kind: "tts",
      ok: false,
      fallback: true,
      detail: message,
    };
    logSlng(log);
    return { audioId, mimeType: "audio/mpeg", bytes, text, fallback: true, log };
  }
}

function transcriptFromSlng(json: unknown): { transcript: string; confidence: number | null } {
  const root = json as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }> };
    transcript?: string;
    text?: string;
  };
  const alt = root.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alt?.transcript ?? root.transcript ?? root.text ?? "";
  const confidence = typeof alt?.confidence === "number" ? alt.confidence : null;
  return { transcript, confidence };
}

export async function transcribeAudio(input: {
  bytes?: Buffer;
  url?: string;
  mimeType?: string;
}): Promise<SttResult> {
  const started_at = new Date().toISOString();
  const t0 = Date.now();
  const key = process.env.SLNG_API_KEY?.trim();

  if (!key) {
    const log: SlngLog = {
      started_at,
      latency_ms: Date.now() - t0,
      kind: "stt",
      ok: false,
      fallback: true,
      detail: "SLNG_API_KEY unset — empty transcript",
    };
    logSlng(log);
    return { transcript: "", confidence: null, fallback: true, log };
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
    };
    let body: BodyInit;
    if (input.url) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        url: input.url,
        language: "es",
        punctuate: true,
        smart_format: true,
        numerals: true,
      });
    } else {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(input.bytes ?? Buffer.alloc(0))], {
        type: input.mimeType ?? "audio/mpeg",
      });
      form.append("audio", blob, "recording.mp3");
      form.append("language", "es");
      form.append("punctuate", "true");
      form.append("smart_format", "true");
      form.append("numerals", "true");
      body = form;
    }

    const response = await fetch(`${slngBaseUrl()}${SLNG_STT_PATH}`, {
      method: "POST",
      headers,
      body,
    });
    if (!response.ok) {
      throw new Error(`SLNG STT ${response.status}`);
    }
    const parsed = transcriptFromSlng(await response.json());
    const log: SlngLog = {
      started_at,
      latency_ms: Date.now() - t0,
      kind: "stt",
      ok: true,
      fallback: false,
      quality: parsed.confidence !== null ? String(parsed.confidence) : undefined,
      cost: response.headers.get("x-slng-cost") ?? undefined,
      detail: `stt ${parsed.transcript.length} chars`,
    };
    logSlng(log);
    return { ...parsed, fallback: false, log };
  } catch (error) {
    const message = error instanceof Error ? error.message : "stt failed";
    const log: SlngLog = {
      started_at,
      latency_ms: Date.now() - t0,
      kind: "stt",
      ok: false,
      fallback: true,
      detail: message,
    };
    logSlng(log);
    return { transcript: "", confidence: null, fallback: true, log };
  }
}

export function slngReady(): boolean {
  return slngConfigured();
}
