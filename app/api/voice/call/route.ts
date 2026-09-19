import { approveSiteCall, denySiteCall, listVoiceSummaries, requestSiteCall } from "@/lib/voice-calls";
import { getVoiceStatus } from "@/lib/voice-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    voice: getVoiceStatus(),
    calls: await listVoiceSummaries(),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    siteId?: unknown;
    toNumber?: unknown;
    callId?: unknown;
    town?: unknown;
  } | null;

  const action = typeof body?.action === "string" ? body.action : "";

  try {
    if (action === "request") {
      const siteId = typeof body?.siteId === "string" ? body.siteId : "";
      const toNumber = typeof body?.toNumber === "string" ? body.toNumber : "";
      const result = await requestSiteCall({ siteId, toNumber });
      return Response.json({ ok: true, ...result, voice: getVoiceStatus() });
    }
    if (action === "approve" || action === "retry") {
      const callId = typeof body?.callId === "string" ? body.callId : "";
      const town = typeof body?.town === "string" ? body.town : undefined;
      const result = await approveSiteCall({
        callId,
        town,
        retry: action === "retry",
      });
      return Response.json({ ok: true, ...result, voice: getVoiceStatus() });
    }
    if (action === "deny") {
      const callId = typeof body?.callId === "string" ? body.callId : "";
      const call = await denySiteCall(callId);
      return Response.json({ ok: true, call, voice: getVoiceStatus() });
    }
    return Response.json({ ok: false, error: "action must be request, approve, retry, or deny" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "voice call failed";
    return Response.json({ ok: false, error: message, voice: getVoiceStatus() }, { status: 400 });
  }
}
