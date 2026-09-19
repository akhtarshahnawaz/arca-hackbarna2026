import type { ChannelHandlers } from "@mastra/core/channels";
import type { TelegramProvider } from "@mastra/telegram";
import {
  RESIDENT_REPLY,
  STRANGER_REPLY,
  collectTelegramIds,
  telegramRole,
} from "../lib/telegram-access";

const ARCA_AGENT_ID = "arca-agent";

const COMMANDS = [
  { command: "start", description: "Who ARCA is and who you are talking to" },
  { command: "briefing", description: "Demo fire, simulation, ranked call list" },
  { command: "help", description: "Coordinator vs resident commands" },
];

async function postSafe(target: { post: (text: string) => Promise<unknown> } | null | undefined, text: string) {
  if (!target) return;
  try {
    await target.post(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "post failed";
    console.error(`ARCA Telegram post failed: ${message}`);
  }
}

function replyForIds(ids: string[]): { role: "coordinator" | "resident" | "stranger"; text: string | null } {
  const role = telegramRole(ids);
  if (role === "coordinator") return { role, text: null };
  if (role === "resident") return { role, text: RESIDENT_REPLY };
  return { role, text: STRANGER_REPLY };
}

/**
 * Telegram chat-id lock. Studio / the laptop map stay open.
 * COORDINATOR_TELEGRAM_CHAT_ID is required for briefing and Approve on Telegram.
 * A phone number is not a chat id.
 */
export const telegramChannelHandlers: ChannelHandlers = {
  onDirectMessage: async (thread, message, defaultHandler) => {
    const ids = collectTelegramIds(thread.channelId, message.author?.userId);
    const { role, text } = replyForIds(ids);
    console.info(`ARCA Telegram DM role=${role} (copy a numeric chat id into .env.local, not a phone)`);
    if (role === "coordinator") {
      await defaultHandler(thread, message);
      return;
    }
    if (role === "resident") {
      await defaultHandler(thread, message);
      return;
    }
    await postSafe(thread, text ?? STRANGER_REPLY);
  },
  onMention: async (thread, message, defaultHandler) => {
    const ids = collectTelegramIds(thread.channelId, message.author?.userId);
    const { role, text } = replyForIds(ids);
    if (role === "coordinator") {
      await defaultHandler(thread, message);
      return;
    }
    await postSafe(thread, text ?? STRANGER_REPLY);
  },
  onSubscribedMessage: async (thread, message, defaultHandler) => {
    const ids = collectTelegramIds(thread.channelId, message.author?.userId);
    const { role, text } = replyForIds(ids);
    if (role === "coordinator" || role === "resident") {
      await defaultHandler(thread, message);
      return;
    }
    await postSafe(thread, text ?? STRANGER_REPLY);
  },
  onSlashCommand: async (event, defaultHandler) => {
    const ids = collectTelegramIds(event.user?.userId, event.channel?.id);
    const { role, text } = replyForIds(ids);
    if (role === "coordinator") {
      await defaultHandler();
      return;
    }
    await postSafe(event.channel, text ?? STRANGER_REPLY);
  },
  onAction: async (event, defaultHandler) => {
    const ids = collectTelegramIds(event.user?.userId, event.thread?.channelId);
    const { role } = replyForIds(ids);
    if (role === "coordinator") {
      await defaultHandler();
      return;
    }
    await postSafe(event.thread, STRANGER_REPLY);
  },
};

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
