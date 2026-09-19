import type { ChannelContext } from "@mastra/core/channels";
import {
  coordinatorTelegramChatId,
  demoResidentTelegramChatId,
} from "./demo-cast";

export const STRANGER_REPLY = [
  "ARCA is an automatic wildfire alert assistant for civil-protection coordinators.",
  "This chat is not on the coordinator list, so I will not share the ranked site list or follow call commands.",
  "If you are a resident in the demo zone, ask the coordinator to register your Telegram chat id after you send /start to this bot.",
  "If you are the coordinator, set COORDINATOR_TELEGRAM_CHAT_ID to your Telegram chat id (not your phone number) and try again.",
].join(" ");

export const RESIDENT_REPLY = [
  "ARCA is the wildfire assistant. You are on the demo resident list.",
  "You will get a stay-inside notice only after the coordinator Approves.",
  "You will not see the ranked call list. Reply with your address and animals if you need to update your registration.",
].join(" ");

export const COORDINATOR_TOOLS_LOCKED =
  "REFUSED: Coordinator tools are only available to COORDINATOR_TELEGRAM_CHAT_ID on Telegram. Studio and the laptop map stay open when that id is unset. A phone number is not a Telegram chat id.";

export type TelegramActor = {
  surface: "telegram" | "studio";
  ids: string[];
};

type ContextBag = { get?: (key: string) => unknown } | undefined;

export function normalizeTelegramId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  const last = parts[parts.length - 1] ?? trimmed;
  const compact = last.replace(/[^\d-]/g, "");
  return compact || trimmed;
}

export function telegramIdsMatch(left: string, right: string): boolean {
  const a = normalizeTelegramId(left);
  const b = normalizeTelegramId(right);
  return Boolean(a && b && a === b);
}

export function collectTelegramIds(...values: Array<string | null | undefined>): string[] {
  const ids = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTelegramId(value);
    if (normalized) ids.add(normalized);
  }
  return [...ids];
}

export function actorFromRequestContext(requestContext: ContextBag): TelegramActor {
  const channel = requestContext?.get?.("channel") as ChannelContext | undefined;
  if (!channel || channel.platform !== "telegram") {
    return { surface: "studio", ids: [] };
  }
  return {
    surface: "telegram",
    ids: collectTelegramIds(channel.userId, channel.channelId, channel.threadId),
  };
}

export function isCoordinatorTelegram(ids: string[]): boolean {
  const expected = coordinatorTelegramChatId();
  if (!expected) return false;
  return ids.some((id) => telegramIdsMatch(id, expected));
}

export function isResidentTelegram(ids: string[]): boolean {
  const expected = demoResidentTelegramChatId();
  if (!expected) return false;
  return ids.some((id) => telegramIdsMatch(id, expected));
}

export function telegramRole(ids: string[]): "coordinator" | "resident" | "stranger" {
  if (isCoordinatorTelegram(ids)) return "coordinator";
  if (isResidentTelegram(ids)) return "resident";
  return "stranger";
}

export function coordinatorToolGate(requestContext: ContextBag): { ok: true } | { ok: false; reason: string } {
  const actor = actorFromRequestContext(requestContext);
  if (actor.surface !== "telegram") return { ok: true };
  if (isCoordinatorTelegram(actor.ids)) return { ok: true };
  return { ok: false, reason: COORDINATOR_TOOLS_LOCKED };
}

export function coordinatorToolRefusal(requestContext: ContextBag) {
  const gate = coordinatorToolGate(requestContext);
  if (gate.ok) return null;
  return {
    refused: true as const,
    reason: gate.reason,
    phoneOnFile: false,
    coordinatorMustRepeatVerbatim: `SAY_THIS_EXACTLY: ${gate.reason}`,
  };
}
