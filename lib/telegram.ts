/**
 * Bot API helpers. Never log TELEGRAM_BOT_TOKEN.
 * Local Mastra uses polling (`TelegramProvider` mode: polling) so a public
 * webhook is not required. A hosted Sunday deploy can switch to webhook.
 */

export type TelegramSendResult = {
  ok: boolean;
  chatId: string;
  detail: string;
};

function botApiUrl(method: string): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  return `https://api.telegram.org/bot${token}/${method}`;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const url = botApiUrl("sendMessage");
  if (!url) {
    return { ok: false, chatId, detail: "TELEGRAM_BOT_TOKEN is unset" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const json = (await response.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;

  if (!response.ok || !json?.ok) {
    return {
      ok: false,
      chatId,
      detail: json?.description || `Telegram send failed (${response.status})`,
    };
  }

  return { ok: true, chatId, detail: "sent" };
}

export async function getTelegramBotIdentity(): Promise<{
  ok: boolean;
  username: string | null;
  detail: string;
}> {
  const url = botApiUrl("getMe");
  if (!url) {
    return { ok: false, username: null, detail: "TELEGRAM_BOT_TOKEN is unset" };
  }

  const response = await fetch(url);
  const json = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: { username?: string }; description?: string }
    | null;

  if (!response.ok || !json?.ok) {
    return {
      ok: false,
      username: null,
      detail: json?.description || `getMe failed (${response.status})`,
    };
  }

  return {
    ok: true,
    username: json.result?.username ?? null,
    detail: "bot reachable via getMe — polling on mastra:dev, webhook only if you deploy a public URL",
  };
}

export function coordinatorChatId(): string | null {
  return process.env.COORDINATOR_TELEGRAM_CHAT_ID?.trim() || null;
}

export function backupChatId(): string | null {
  return process.env.TELEGRAM_BACKUP_CHAT_ID?.trim() || null;
}

export async function sendTelegramVoice(
  chatId: string,
  bytes: Buffer,
  caption: string,
): Promise<TelegramSendResult> {
  const url = botApiUrl("sendVoice");
  if (!url) {
    return { ok: false, chatId, detail: "TELEGRAM_BOT_TOKEN is unset" };
  }

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption.slice(0, 1024));
  form.append("voice", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), "arca.mp3");

  const response = await fetch(url, { method: "POST", body: form });
  const json = (await response.json().catch(() => null)) as
    | { ok?: boolean; description?: string }
    | null;

  if (!response.ok || !json?.ok) {
    return {
      ok: false,
      chatId,
      detail: json?.description || `Telegram sendVoice failed (${response.status})`,
    };
  }
  return { ok: true, chatId, detail: "voice sent" };
}

export async function downloadTelegramFile(fileId: string): Promise<Buffer | null> {
  const getUrl = botApiUrl("getFile");
  if (!getUrl) return null;
  const meta = await fetch(getUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const json = (await meta.json().catch(() => null)) as {
    ok?: boolean;
    result?: { file_path?: string };
  } | null;
  const filePath = json?.result?.file_path;
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!json?.ok || !filePath || !token) return null;
  const file = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!file.ok) return null;
  return Buffer.from(await file.arrayBuffer());
}
