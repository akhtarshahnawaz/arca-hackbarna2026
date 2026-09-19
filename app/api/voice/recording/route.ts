import { handleRecordingWebhook } from "@/lib/voice-calls";

export const dynamic = "force-dynamic";

function secondsBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, (b - a) / 1000);
}

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId");
  const body = (await request.json().catch(() => null)) as {
    recording_url?: string;
    size?: number;
    start_time?: string;
    end_time?: string;
    duration?: string | number;
  } | null;

  if (!callId) {
    return Response.json({ ok: false, error: "callId required" }, { status: 400 });
  }

  const duration =
    typeof body?.duration === "number"
      ? body.duration
      : typeof body?.duration === "string"
        ? Number(body.duration)
        : secondsBetween(body?.start_time, body?.end_time);

  try {
    const call = await handleRecordingWebhook({
      callId,
      recordingUrl: body?.recording_url,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      sizeBytes: typeof body?.size === "number" ? body.size : null,
    });
    return Response.json({ ok: true, call });
  } catch (error) {
    const message = error instanceof Error ? error.message : "recording webhook failed";
    console.info("ARCA recording webhook", { callId, error: message });
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
