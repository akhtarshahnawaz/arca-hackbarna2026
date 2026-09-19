/**
 * Return arca.db to the Sunday demo fixture.
 * Run: npm run demo:reset
 */

import { resetDemoFixture } from "../lib/demo-reset.ts";

const report = await resetDemoFixture();
console.log("demo_reset_ok");
console.log(`wiped_decisions=true wiped_live_calls=true`);
console.log(`kept_slng_logs=${report.kept.slngLogs} kept_simulations=${report.kept.simulations}`);
console.log(`archived_voice_rows=${report.kept.archivedVoiceRows}`);
console.log(`seeded_resident_telegram=${report.seeded.residentTelegram}`);
console.log(`coordinator_pinged=${report.coordinatorPinged}`);
if (report.kept.archiveFile) {
  console.log(`archive_file=${report.kept.archiveFile}`);
}
