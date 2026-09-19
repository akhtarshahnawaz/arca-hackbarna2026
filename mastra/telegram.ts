import type { TelegramProvider } from "@mastra/telegram";

const ARCA_AGENT_ID = "arca-agent";

const COMMANDS = [
  { command: "start", description: "Who ARCA is and who you are talking to" },
  { command: "briefing", description: "Demo fire, simulation, ranked call list" },
  { command: "help", description: "Coordinator vs resident commands" },
];

/**
 * Local mastra:dev uses Telegram long-polling. No public webhook needed.
 * Telegram forbids webhook + polling on the same bot at once.
 */
export async function connectTelegramIfConfigured(telegram: TelegramProvider): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    console.info("ARCA Telegram idle — TELEGRAM_BOT_TOKEN unset");
    return;
  }

  try {
    const existing = await telegram.getInstallation(ARCA_AGENT_ID);
    if (existing?.status === "active") {
      console.info("ARCA Telegram: installation already active (polling resumes from storage)");
      return;
    }

    const result = await telegram.connect(ARCA_AGENT_ID, {
      botToken,
      name: "ARCA",
      commands: COMMANDS,
    });
    console.info(`ARCA Telegram connected (${result.type}) — polling, not webhook`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "connect failed";
    console.error(`ARCA Telegram connect failed: ${message}`);
  }
}
