import { handleDtmfWebhook } from "@/lib/voice-calls";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const callId = new URL(request.url).searchParams.get("callId");
  const body = (await request.json().catch(() => null)) as {
    dtmf?: { digits?: string | null };
    digits?: string;
  } | null;
  const digits = body?.dtmf?.digits ?? body?.digits ?? "";

  if (!callId) {
    return Response.json({ ok: false, error: "callId required" }, { status: 400 });
  }

  try {
    const call = await handleDtmfWebhook({ callId, digits });
    return Response.json({ ok: true, call });
  } catch (error) {
    const message = error instanceof Error ? error.message : "dtmf webhook failed";
    return Response.json({ ok: false, error: message }, { status: 200 });
  }
}
