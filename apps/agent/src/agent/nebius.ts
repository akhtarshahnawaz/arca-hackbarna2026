import { requestJson } from "@arca/core";
import { env } from "../env.js";
import { describeError } from "../logger.js";

/**
 * Nebius Token Factory, over its OpenAI-compatible surface.
 *
 * Used directly rather than through a framework for the two jobs that need
 * exact control: structured extraction, where the JSON schema is the contract,
 * and briefing generation, where the numbers are injected and the model is only
 * allowed to phrase them. The conversational agent is a different problem and
 * uses Mastra.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionResult<T = string> {
  content: T;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class NebiusClient {
  get configured(): boolean {
    return Boolean(env.nebius.apiKey);
  }

  private async chat(
    messages: ChatMessage[],
    options: { model?: string; temperature?: number; responseFormat?: unknown; maxTokens?: number } = {},
  ): Promise<CompletionResult> {
    if (!this.configured) throw new Error("NEBIUS_API_KEY is not set");
    const startedAt = Date.now();
    const model = options.model ?? env.nebius.model;

    const payload = await requestJson<ChatCompletionResponse>(
      `${env.nebius.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.nebius.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 1200,
          ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        }),
        timeoutMs: 60_000,
        retries: 2,
      },
    );

    return {
      content: payload.choices?.[0]?.message?.content ?? "",
      model: payload.model ?? model,
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  }

  async complete(messages: ChatMessage[], options: { model?: string; temperature?: number; maxTokens?: number } = {}) {
    return this.chat(messages, options);
  }

  /**
   * A completion constrained to a JSON schema.
   *
   * Asks for a schema-constrained response first, then retries in plain JSON
   * mode if the model or the gateway rejects that. Models differ in which they
   * support and the difference is not worth failing an extraction over — the
   * result is validated by zod either way, which is the guarantee that matters.
   */
  async structured<T>(
    messages: ChatMessage[],
    schema: { name: string; schema: unknown },
    options: { model?: string; temperature?: number } = {},
  ): Promise<CompletionResult<T>> {
    const attempt = async (responseFormat: unknown) => {
      const result = await this.chat(messages, { ...options, responseFormat });
      return { ...result, content: parseJson<T>(result.content) };
    };

    try {
      return await attempt({
        type: "json_schema",
        json_schema: { name: schema.name, strict: true, schema: schema.schema },
      });
    } catch (error) {
      const message = describeError(error);
      if (!/schema|response_format|not supported|400/i.test(message)) throw error;
      return attempt({ type: "json_object" });
    }
  }
}

/**
 * Parse a model's JSON, tolerating the two things they still do: wrapping it in
 * a fenced code block, and adding a sentence before it.
 */
export function parseJson<T>(raw: string): T {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    }
    throw new Error(`Model did not return JSON: ${candidate.slice(0, 200)}`);
  }
}

export const nebius = new NebiusClient();
