import { afterEach, describe, expect, it } from "vitest";
import {
  COORDINATOR_TOOLS_LOCKED,
  actorFromRequestContext,
  coordinatorToolGate,
  isCoordinatorTelegram,
  telegramRole,
} from "@/lib/telegram-access";

afterEach(() => {
  delete process.env.COORDINATOR_TELEGRAM_CHAT_ID;
  delete process.env.DEMO_RESIDENT_TELEGRAM_CHAT_ID;
});

describe("stranger lock", () => {
  it("allows Studio when there is no Telegram channel context", () => {
    expect(actorFromRequestContext(undefined).surface).toBe("studio");
    expect(coordinatorToolGate(undefined).ok).toBe(true);
  });

  it("fails closed on Telegram when COORDINATOR_TELEGRAM_CHAT_ID is unset", () => {
    const ctx = {
      get: (key: string) =>
        key === "channel"
          ? { platform: "telegram", userId: "111", channelId: "111" }
          : undefined,
    };
    const gate = coordinatorToolGate(ctx);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toBe(COORDINATOR_TOOLS_LOCKED);
  });

  it("allows only the coordinator chat id, not a phone-shaped id", () => {
    process.env.COORDINATOR_TELEGRAM_CHAT_ID = "111222333";
    expect(isCoordinatorTelegram(["111222333"])).toBe(true);
    expect(isCoordinatorTelegram(["600000001"])).toBe(false);
    expect(telegramRole(["999"])).toBe("stranger");
  });

  it("treats the demo resident chat as resident, not coordinator", () => {
    process.env.COORDINATOR_TELEGRAM_CHAT_ID = "111222333";
    process.env.DEMO_RESIDENT_TELEGRAM_CHAT_ID = "444555666";
    expect(telegramRole(["444555666"])).toBe("resident");
    const ctx = {
      get: (key: string) =>
        key === "channel"
          ? { platform: "telegram", userId: "444555666", channelId: "444555666" }
          : undefined,
    };
    expect(coordinatorToolGate(ctx).ok).toBe(false);
  });
});
