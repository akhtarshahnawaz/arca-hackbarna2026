/**
 * Check the bot token with getMe. Never prints the token.
 * Run: nvm use 22 && npm run telegram:ping
 */

import { getTelegramBotIdentity } from "../lib/telegram.ts";

const identity = await getTelegramBotIdentity();
if (!identity.ok) {
  console.error(`telegram_fail ${identity.detail}`);
  process.exitCode = 1;
} else {
  console.log(`telegram_ok username=${identity.username ?? "unknown"}`);
  console.log(identity.detail);
}
