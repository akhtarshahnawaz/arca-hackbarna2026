import { getVoiceCall, updateVoiceCall } from "@/lib/db";
import { VOICE_CALL_POLICY } from "@/lib/voice-policy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId");
  const body = (await request.json().catch(() => null)) as {
    status?: string;
    duration?: string | number;
    uuid?: string;
  } | null;

  console.info("ARCA Vonage event", {
    callId,
    status: body?.status,
    duration: body?.duration,
    autoRetry: VOICE_CALL_POLICY.autoRetryOnEmpty,
  });

  if (callId && body?.uuid) {
    const existing = await getVoiceCall(callId).catch(() => null);
    if (existing && !existing.vonageUuid) {
      await updateVoiceCall(callId, { vonageUuid: body.uuid });
    }
  }

  return Response.json({ ok: true, autoRetry: false });
}
