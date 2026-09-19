import { CommandConsole } from "@/components/command-console";
import { getCommandState } from "@/lib/command";

export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await getCommandState();
  return <CommandConsole initial={state} />;
}
