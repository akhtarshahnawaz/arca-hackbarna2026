import { handleVonageEvent, processDueVoiceRetries } from "@/lib/voice-calls";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId");
  const body = (await request.json().catch(() => null)) as {
    status?: string;
    duration?: string | number;
    uuid?: string;
    detail?: string;
  } | null;

  const duration =
    typeof body?.duration === "number"
      ? body.duration
      : typeof body?.duration === "string"
        ? Number(body.duration)
        : null;

  console.info("ARCA Vonage event", {
    callId,
    status: body?.status,
    duration,
    autoRetryLoop: false,
  });

  if (callId) {
    await handleVonageEvent({
      callId,
      status: body?.status,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      machine: body?.status === "machine" || body?.detail === "machine",
      uuid: body?.uuid,
    }).catch((error) => {
      console.info("ARCA Vonage event handler", {
        callId,
        error: error instanceof Error ? error.message : "failed",
      });
    });
  }

  const due = await processDueVoiceRetries().catch(() => 0);
  return Response.json({ ok: true, autoRetryLoop: false, dueRetries: due });
}
