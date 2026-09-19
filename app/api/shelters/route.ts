import {
  parseShelterConfig,
  readShelterConfigFromDisk,
  shelterSourceDetail,
  writeShelterConfig,
} from "@/lib/shelters";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await readShelterConfigFromDisk();
  return Response.json({
    ok: true,
    label: config.label,
    note: config.note,
    detail: shelterSourceDetail(config),
    shelters: config.shelters,
  });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const config = await writeShelterConfig(parseShelterConfig(body));
    return Response.json({
      ok: true,
      label: config.label,
      note: config.note,
      detail: shelterSourceDetail(config),
      shelters: config.shelters,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "could not write shelters";
    return Response.json(
      {
        ok: false,
        error: `${message}. Edit config/shelters.json if the console cannot write the file.`,
      },
      { status: 400 },
    );
  }
}
