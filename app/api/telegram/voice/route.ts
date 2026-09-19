import { saveReportedConfirmation } from "@/lib/db";
import { structurePhoneReport } from "@/lib/nebius-parse";
import { transcribeAudio } from "@/lib/slng";
import { downloadTelegramFile } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    fileId?: unknown;
    siteId?: unknown;
  } | null;
  const fileId = typeof body?.fileId === "string" ? body.fileId : "";
  const siteId = typeof body?.siteId === "string" ? body.siteId : "";
  if (!fileId) {
    return Response.json({ ok: false, error: "fileId required" }, { status: 400 });
  }

  const bytes = await downloadTelegramFile(fileId);
  if (!bytes) {
    return Response.json({ ok: false, error: "Telegram file download failed" }, { status: 400 });
  }

  const stt = await transcribeAudio({ bytes, mimeType: "audio/ogg" });
  const report = await structurePhoneReport(stt.transcript);
  if (siteId && report.species && report.count !== null) {
    await saveReportedConfirmation({
      siteId,
      species: report.species,
      count: report.count,
      hasTransport: report.truck,
      channel: "telegram",
    });
  }

  return Response.json({ ok: true, transcript: stt.transcript, report, fallback: stt.fallback });
}
