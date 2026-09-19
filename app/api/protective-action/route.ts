import { saveProtectiveAction } from "@/lib/db";
import { isProtectiveAction } from "@/lib/protective-action";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    siteId?: unknown;
    action?: unknown;
  } | null;

  const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
  if (!siteId || !isProtectiveAction(body?.action)) {
    return Response.json(
      { ok: false, error: "siteId and action (monitor, latent, confine, evacuate) are required" },
      { status: 400 },
    );
  }

  await saveProtectiveAction({ siteId, action: body.action });
  return Response.json({ ok: true, siteId, action: body.action });
}
