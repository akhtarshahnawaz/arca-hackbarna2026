import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  countTable,
  ensureArcaSchema,
  insertVoiceCall,
  listProtectiveActions,
  listVoiceCalls,
  resetArcaConnection,
  saveProtectiveAction,
  saveReportedConfirmation,
  saveSlngLog,
  upsertResident,
} from "@/lib/db";
import { resetDemoFixture } from "@/lib/demo-reset";

const previousUrl = process.env.DATABASE_URL;

afterEach(async () => {
  await resetArcaConnection();
  if (previousUrl) process.env.DATABASE_URL = previousUrl;
  else delete process.env.DATABASE_URL;
  delete process.env.DEMO_RESIDENT_TELEGRAM_CHAT_ID;
  delete process.env.COORDINATOR_TELEGRAM_CHAT_ID;
});

describe("demo reset", () => {
  it("wipes decisions and pending calls, keeps slng logs, archives confirmed transcripts", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arca-reset-"));
    process.env.DATABASE_URL = `file:${path.join(dir, "arca.db")}`;
    process.env.DEMO_RESIDENT_TELEGRAM_CHAT_ID = "444555666";
    delete process.env.COORDINATOR_TELEGRAM_CHAT_ID;
    await resetArcaConnection();
    await ensureArcaSchema();

    await saveProtectiveAction({ siteId: "REGA-B-1842", action: "evacuate" });
    await saveReportedConfirmation({
      siteId: "REGA-B-1842",
      species: "sheep",
      count: 999,
      hasTransport: true,
    });
    await upsertResident({
      telegramId: "old-resident",
      address: "stale",
      animals: [],
      hasTransport: false,
    });
    await insertVoiceCall({
      id: "pending-call",
      siteId: "REGA-B-1842",
      toNumber: "600000000",
      status: "awaiting_approval",
    });
    await insertVoiceCall({
      id: "kept-call",
      siteId: "REGA-B-1842",
      toNumber: "600000000",
      status: "confirmed",
    });
    const { updateVoiceCall } = await import("@/lib/db");
    await updateVoiceCall("kept-call", { transcript: "trescientas ovejas" });
    await saveSlngLog({
      started_at: new Date().toISOString(),
      latency_ms: 12,
      kind: "tts",
      ok: true,
      detail: "keep me",
    });

    const report = await resetDemoFixture();
    expect(report.kept.archivedVoiceRows).toBe(1);
    expect(report.kept.slngLogs).toBe(1);
    expect(report.seeded.residentTelegram).toBe(true);
    expect((await listProtectiveActions()).size).toBe(0);
    expect(await listVoiceCalls()).toEqual([]);
    expect(await countTable("confirmations")).toBe(0);
    expect(await countTable("slng_logs")).toBe(1);
    expect(await countTable("residents")).toBe(1);
  });
});
