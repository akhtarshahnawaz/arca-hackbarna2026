import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEMO_RESIDENT_SITE_CODE,
  coordinatorTelegramChatId,
  demoResidentTelegramChatId,
} from "./demo-cast.ts";
import {
  archiveVoiceEvidence,
  countTable,
  ensureArcaSchema,
  listVoiceCalls,
  upsertResident,
  wipeDemoRuntimeTables,
} from "./db.ts";
import { coordinatorChatId, sendTelegramMessage } from "./telegram.ts";

export type DemoResetReport = {
  wiped: {
    protectiveActions: boolean;
    confirmations: boolean;
    alertRequests: boolean;
    residents: boolean;
    liveVoiceCalls: boolean;
  };
  kept: {
    slngLogs: number;
    simulations: number;
    archivedVoiceRows: number;
    archiveFile: string | null;
  };
  seeded: {
    residentTelegram: boolean;
    residentSite: string;
  };
  coordinatorPinged: boolean;
};

function evidenceRows<T extends { transcript: string | null; status: string }>(rows: T[]): T[] {
  return rows.filter((row) => Boolean(row.transcript?.trim()) || row.status === "confirmed");
}

export async function resetDemoFixture(): Promise<DemoResetReport> {
  await ensureArcaSchema();
  const live = await listVoiceCalls(200);
  const keeps = evidenceRows(live);
  const archivedVoiceRows = await archiveVoiceEvidence(keeps);

  let archiveFile: string | null = null;
  if (keeps.length > 0) {
    const dir = path.resolve(process.cwd(), "data/demo-keeps");
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    archiveFile = path.join(dir, `voice-${stamp}.json`);
    await writeFile(
      archiveFile,
      JSON.stringify(
        keeps.map((row) => ({
          id: row.id,
          siteId: row.siteId,
          toLast4: row.toNumber.replace(/\D/g, "").slice(-4) || "????",
          status: row.status,
          transcript: row.transcript,
          outcome: row.outcome,
          createdAt: row.createdAt,
        })),
        null,
        2,
      ),
    );
  }

  const slngLogs = await countTable("slng_logs");
  const simulations = await countTable("simulations");
  await wipeDemoRuntimeTables();

  const residentChatId = demoResidentTelegramChatId();
  if (residentChatId) {
    await upsertResident({
      telegramId: residentChatId,
      address: "Castellnou de Bages — HH-PET-07",
      lat: 41.738,
      lon: 1.844,
      animals: [{ species: "dogs", registeredCapacity: 2, confirmedCount: 2 }],
      hasTransport: false,
    });
  }

  let coordinatorPinged = false;
  const coordinator = coordinatorChatId() ?? coordinatorTelegramChatId();
  if (coordinator) {
    const ping = await sendTelegramMessage(
      coordinator,
      "ARCA demo reset. INC-DEMO Bages is loaded. No Confine/Evacuate yet. Open the map.",
    );
    coordinatorPinged = ping.ok;
  }

  return {
    wiped: {
      protectiveActions: true,
      confirmations: true,
      alertRequests: true,
      residents: true,
      liveVoiceCalls: true,
    },
    kept: {
      slngLogs,
      simulations,
      archivedVoiceRows,
      archiveFile,
    },
    seeded: {
      residentTelegram: Boolean(residentChatId),
      residentSite: DEMO_RESIDENT_SITE_CODE,
    },
    coordinatorPinged,
  };
}
