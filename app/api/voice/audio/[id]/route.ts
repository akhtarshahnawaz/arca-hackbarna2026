import { readFile } from "node:fs/promises";
import { audioFilePath } from "@/lib/slng";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("not found", { status: 404 });
  }
  try {
    const bytes = await readFile(audioFilePath(id));
    return new Response(bytes, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
