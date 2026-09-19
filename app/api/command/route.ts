import { getCommandState } from "@/lib/command";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getCommandState();
  console.info("ARCA command", {
    sites: state.sites.length,
    watch: state.watch.length,
    hotspots: state.hotspots.length,
    banners: state.banners.length,
  });
  return Response.json(state);
}
