import type { OpenAICompatibleConfig } from "@mastra/core/llm";

/**
 * Token Factory model id from the official catalog and Mastra's Nebius list.
 * https://tokenfactory.nebius.com/model-catalog.md
 * https://mastra.ai/models/providers/nebius
 */
export const DEFAULT_NEBIUS_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507";

/** Official OpenAI-compatible base URL (trailing slash as in Token Factory snippets). */
export const DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/";

export const MISSING_NEBIUS_KEY_MESSAGE =
  "set NEBIUS_API_KEY from Token Factory";

export function requireNebiusApiKey(): string {
  const apiKey = process.env.NEBIUS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(MISSING_NEBIUS_KEY_MESSAGE);
  }
  return apiKey;
}

export function resolveNebiusModelId(): string {
  const raw = process.env.NEBIUS_MODEL?.trim() || DEFAULT_NEBIUS_MODEL;
  return raw.startsWith("nebius/") ? raw.slice("nebius/".length) : raw;
}

export function resolveNebiusBaseUrl(): string {
  return process.env.NEBIUS_BASE_URL?.trim() || DEFAULT_NEBIUS_BASE_URL;
}

/**
 * Mastra custom OpenAI-compatible provider for Nebius Token Factory.
 * Sends `Qwen/Qwen3-30B-A3B-Instruct-2507` (or `NEBIUS_MODEL`) to
 * https://api.tokenfactory.nebius.com/v1/chat/completions
 */
export function tokenFactoryModel(): OpenAICompatibleConfig {
  const modelId = resolveNebiusModelId();
  return {
    id: `nebius/${modelId}`,
    url: resolveNebiusBaseUrl(),
    apiKey: requireNebiusApiKey(),
  };
}
