import { requestJson, type Incident, type RankingResult } from "@arca/core";
import { env } from "../env.js";
import { describeError } from "../logger.js";
import type { Context } from "../context.js";
import type { IncidentService } from "../pipeline/incident.js";
import type { CoordinatorAgent } from "../agent/coordinator.js";
import { STRANGER_REPLY } from "../agent/instructions.js";

/**
 * Telegram, against the Bot API directly.
 *
 * Direct rather than through an adapter because the approval card is the
 * safety-critical surface of this product, and it has to be the same object the
 * web UI approves: one callback, one decision record, one dispatch path. An
 * adapter with its own approval concept would give two, which is one more than
 * can be audited.
 *
 * Long-polling in development so no public URL is needed; webhook in production
 * because polling does not survive a platform that sleeps idle containers.
 */

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    voice?: { file_id: string };
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { chat: { id: number }; message_id: number };
    data?: string;
  };
}

export class TelegramBot {
  private offset = 0;
  private polling = false;
  private readonly history = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

  constructor(
    private readonly ctx: Context,
    private readonly incidents: IncidentService,
    private readonly agent: CoordinatorAgent,
  ) {}

  get configured(): boolean {
    return Boolean(env.telegram.botToken);
  }

  private api<T>(method: string, body: unknown): Promise<T> {
    return requestJson<T>(`https://api.telegram.org/bot${env.telegram.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 20_000,
      retries: 1,
    });
  }

  /** Only these chats see incident data or can authorise anything. */
  private isCoordinator(chatId: number | string): boolean {
    return env.telegram.coordinatorChatIds.includes(String(chatId));
  }

  async send(
    chatId: string | number,
    text: string,
    keyboard?: Array<Array<{ text: string; callback_data: string }>>,
  ): Promise<void> {
    if (!this.configured) return;
    await this.api("sendMessage", {
      chat_id: chatId,
      text,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }).catch((error) =>
      this.ctx.log.error("Telegram send failed", { error: describeError(error), chatId }),
    );
  }

  async broadcast(text: string, keyboard?: Array<Array<{ text: string; callback_data: string }>>): Promise<void> {
    for (const chatId of env.telegram.coordinatorChatIds) {
      await this.send(chatId, text, keyboard);
    }
  }

  /** The proactive briefing, with the top three sites offered for approval. */
  async briefIncident(incident: Incident, text: string, ranking: RankingResult | null): Promise<void> {
    const callable = (ranking?.ranked ?? [])
      .filter((site) => site.action === "EVACUATE_NOW" || site.action === "SHELTER_CANDIDATE")
      .slice(0, 3);

    const keyboard = callable.map((site) => [
      {
        text: `Call ${site.name.slice(0, 28)}`,
        callback_data: `call:${incident.id}:${site.assetId}`.slice(0, 64),
      },
    ]);
    keyboard.push([{ text: "Show the full list", callback_data: `list:${incident.id}` }]);

    await this.broadcast(text, keyboard);
    await this.ctx.timeline(incident.id, "approval_requested", `Briefed the coordinator with ${callable.length} call suggestions.`);
  }

  /**
   * The approval card raised by the agent.
   *
   * Returns the text shown, so the agent can tell the coordinator what it
   * asked rather than claiming the call is under way.
   */
  async requestApproval(input: {
    incidentId: string;
    assetId: string;
    siteName: string;
    reason: string;
  }): Promise<string> {
    const text = `${env.safety.exerciseMode ? "SIMULACRO / EXERCISE\n\n" : ""}Approve a call to ${input.siteName}?\n\n${input.reason}\n\nNothing is dialled until you approve.`;
    await this.broadcast(text, [
      [
        { text: "Approve call", callback_data: `call:${input.incidentId}:${input.assetId}`.slice(0, 64) },
        { text: "Deny", callback_data: `deny:${input.incidentId}:${input.assetId}`.slice(0, 64) },
      ],
    ]);
    return `Sent an approval card for ${input.siteName}. Nothing is dialled until the coordinator approves.`;
  }

  // ---------------------------------------------------------------------------
  // Update handling
  // ---------------------------------------------------------------------------

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.callback_query) return await this.handleCallback(update.callback_query);
      if (update.message) return await this.handleMessage(update.message);
    } catch (error) {
      this.ctx.log.error("Telegram update failed", { error: describeError(error) });
    }
  }

  private async handleMessage(message: NonNullable<TelegramUpdate["message"]>): Promise<void> {
    const chatId = message.chat.id;

    if (!this.isCoordinator(chatId)) {
      // A stranger gets a straight explanation of what this is, and nothing
      // about any incident. Politeness is not the point; the lock is.
      await this.send(chatId, `${STRANGER_REPLY}\n\nYour chat id is ${chatId}.`);
      return;
    }

    let text = message.text?.trim() ?? "";

    if (message.voice) {
      const transcript = await this.transcribeVoice(message.voice.file_id);
      if (!transcript) {
        await this.send(chatId, "I could not transcribe that voice note. Please type it.");
        return;
      }
      text = transcript;
      await this.send(chatId, `Heard: "${transcript}"`);
    }

    if (!text) return;

    if (text.startsWith("/")) return this.handleCommand(chatId, text);

    const key = String(chatId);
    const history = this.history.get(key) ?? [];
    const answer = await this.agent.ask({ message: text, conversationId: key, history });

    history.push({ role: "user", content: text }, { role: "assistant", content: answer.text });
    this.history.set(key, history.slice(-20));

    await this.send(chatId, answer.text);
  }

  private async handleCommand(chatId: number, text: string): Promise<void> {
    const [command] = text.split(/\s+/);
    switch (command) {
      case "/start":
      case "/help":
        await this.send(
          chatId,
          [
            "ARCA — wildfire values-at-risk coordination.",
            "",
            "Ask me things like:",
            "· what's burning?",
            "· who do we call first at <fire>?",
            "· why is <site> first?",
            "· what does the model assume about care homes?",
            "",
            "/incidents lists what is open. /status shows what this deployment can do.",
            "I never place a call on my own. Approving a card is what dials.",
          ].join("\n"),
        );
        return;
      case "/incidents": {
        const incidents = await this.ctx.store.listIncidents({
          status: ["candidate", "confirmed", "monitoring"],
        });
        if (incidents.length === 0) {
          await this.send(chatId, "No incidents are open.");
          return;
        }
        const lines = incidents
          .slice(0, 10)
          .map((incident) => `${incident.name} — ${incident.status}, ${incident.confirmation.score}/100`);
        await this.send(chatId, lines.join("\n"));
        return;
      }
      case "/status": {
        const caps = this.ctx.capabilities;
        await this.send(
          chatId,
          [
            `Detection: ${caps.deepfire ? "live" : "off (replay only)"}`,
            `Exposure: ${caps.talaia ? "live" : "unavailable"}`,
            `Assistant: ${caps.nebius ? "on" : "off"}`,
            `Voice: ${caps.outboundCalls ? "calls enabled" : caps.slng ? "browser sessions only" : "off"}`,
            `Exercise mode: ${caps.exerciseMode ? "on" : "off"}`,
            `Storage: ${this.ctx.store.kind}`,
          ].join("\n"),
        );
        return;
      }
      default:
        await this.send(chatId, "Unknown command. Try /help.");
    }
  }

  /**
   * The Approve button.
   *
   * Goes straight to the same service the web UI calls. The coordinator is
   * identified by their Telegram id and that id is what lands in the decision
   * record, so "who approved this" has an answer months later.
   */
  private async handleCallback(query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    const chatId = query.message?.chat.id;
    const answer = (text: string) =>
      this.api("answerCallbackQuery", { callback_query_id: query.id, text: text.slice(0, 200) }).catch(
        () => undefined,
      );

    if (!chatId || !this.isCoordinator(chatId)) {
      await answer("Not authorised.");
      return;
    }

    const [action, incidentId, assetId] = (query.data ?? "").split(":");
    const actor = query.from.username ? `@${query.from.username}` : `telegram:${query.from.id}`;

    if (action === "list" && incidentId) {
      const sites = await this.ctx.store.getSites(incidentId);
      const ranked = sites.filter((site) => site.rank > 0).slice(0, 10);
      await answer("Sending the list.");
      await this.send(
        chatId,
        ranked.length === 0
          ? "Nothing ranked yet."
          : ranked
              .map(
                (site) =>
                  `${site.rank}. ${site.payload.name} — ${site.action.replace(/_/g, " ").toLowerCase()}, spare ${site.spareMinutes === null ? "unknown" : `${Math.round(site.spareMinutes)} min`}`,
              )
              .join("\n"),
      );
      return;
    }

    if (action === "deny" && incidentId && assetId) {
      await this.incidents.recordDecision({
        incidentId,
        siteId: assetId,
        kind: "deny",
        actor,
        via: "telegram",
        note: "Denied from the approval card.",
      });
      await this.ctx.timeline(incidentId, "denied", `${actor} denied the call.`, { actor });
      await answer("Denied. Nothing was dialled.");
      return;
    }

    if (action === "call" && incidentId && assetId) {
      await answer("Approved. Dialling.");
      try {
        const result = await this.incidents.dispatchApprovedCall({
          incidentId,
          assetId,
          actor,
          via: "telegram",
        });
        await this.send(chatId, result.message);
      } catch (error) {
        await this.send(chatId, `The call could not be placed: ${describeError(error)}`);
      }
      return;
    }

    await answer("Unrecognised action.");
  }

  private async transcribeVoice(fileId: string): Promise<string | null> {
    try {
      const file = await requestJson<{ result?: { file_path?: string } }>(
        `https://api.telegram.org/bot${env.telegram.botToken}/getFile?file_id=${fileId}`,
        { timeoutMs: 15_000 },
      );
      const path = file.result?.file_path;
      if (!path) return null;
      const response = await fetch(
        `https://api.telegram.org/file/bot${env.telegram.botToken}/${path}`,
      );
      if (!response.ok) return null;
      const audio = new Uint8Array(await response.arrayBuffer());
      return this.incidents.voice.transcribe(audio, "note.ogg");
    } catch (error) {
      this.ctx.log.warn("Voice note download failed", { error: describeError(error) });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Transports
  // ---------------------------------------------------------------------------

  /** Long-polling, for local development with no public URL. */
  startPolling(): void {
    if (!this.configured || this.polling) return;
    this.polling = true;
    this.ctx.log.info("Telegram polling started.");

    const loop = async (): Promise<void> => {
      while (this.polling) {
        try {
          const response = await requestJson<{ result?: TelegramUpdate[] }>(
            `https://api.telegram.org/bot${env.telegram.botToken}/getUpdates`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ offset: this.offset, timeout: 25 }),
              timeoutMs: 35_000,
              retries: 0,
            },
          );
          for (const update of response.result ?? []) {
            this.offset = Math.max(this.offset, update.update_id + 1);
            await this.handleUpdate(update);
          }
        } catch {
          // A dropped long-poll is normal. Pause briefly rather than spinning.
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }
    };

    void loop();
  }

  stopPolling(): void {
    this.polling = false;
  }

  /** Register the webhook. Production, where polling cannot survive a sleep. */
  async registerWebhook(publicUrl: string): Promise<boolean> {
    if (!this.configured) return false;
    try {
      await this.api("setWebhook", {
        url: `${publicUrl.replace(/\/$/, "")}/api/telegram/webhook`,
        secret_token: env.telegram.webhookSecret || undefined,
        allowed_updates: ["message", "callback_query"],
      });
      this.ctx.log.info("Telegram webhook registered.");
      return true;
    } catch (error) {
      this.ctx.log.error("Telegram webhook registration failed", { error: describeError(error) });
      return false;
    }
  }

  async deleteWebhook(): Promise<void> {
    if (!this.configured) return;
    await this.api("deleteWebhook", {}).catch(() => undefined);
  }
}
