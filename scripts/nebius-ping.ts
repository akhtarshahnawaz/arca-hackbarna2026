/**
 * Token Factory connectivity check. Fails clearly when the UI key is missing.
 * Run: nvm use 22 && npm run nebius:ping
 */

const MISSING_KEY = "set NEBIUS_API_KEY from Token Factory";
const DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";
const DEFAULT_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507";

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function main(): Promise<void> {
  const apiKey = process.env.NEBIUS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(MISSING_KEY);
  }

  const rawModel = process.env.NEBIUS_MODEL?.trim() || DEFAULT_MODEL;
  const model = rawModel.startsWith("nebius/")
    ? rawModel.slice("nebius/".length)
    : rawModel;
  const baseURL = process.env.NEBIUS_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const url = joinUrl(baseURL, "chat/completions");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token Factory ${response.status}: ${body.slice(0, 400)}`);
  }

  console.log(`Token Factory ok · model ${model}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});

export {};
