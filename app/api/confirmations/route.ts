import { saveReportedConfirmation } from "@/lib/db";
import { getCommandState } from "@/lib/command";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    siteId?: unknown;
    species?: unknown;
    count?: unknown;
    hasTransport?: unknown;
  } | null;

  const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
  const species = typeof body?.species === "string" ? body.species.trim() : "";
  const count = typeof body?.count === "number" ? body.count : Number(body?.count);
  const hasTransport =
    typeof body?.hasTransport === "boolean" ? body.hasTransport : null;

  if (!siteId || !species || !Number.isFinite(count) || count < 0) {
    return Response.json(
      { ok: false, error: "siteId, species, and a non-negative count are required" },
      { status: 400 },
    );
  }

  const saved = await saveReportedConfirmation({
    siteId,
    species,
    count: Math.round(count),
    hasTransport,
  });
  const state = await getCommandState();
  const site = [...state.sites, ...state.watch].find(
    (item) => item.code === siteId || item.id === siteId,
  );

  console.info("ARCA confirmation", {
    siteId,
    species,
    status: saved.source,
    rank: site?.rank ?? null,
  });

  return Response.json({
    ok: true,
    status: saved.source,
    reportedAt: saved.reportedAt,
    rank: site?.rank ?? null,
    spareTime: site?.spareTime ?? null,
  });
}
