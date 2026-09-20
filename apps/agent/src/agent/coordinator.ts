import { Agent } from "@mastra/core/agent";
import { env } from "../env.js";
import { coordinatorInstructions } from "./instructions.js";
import { buildTools, type ToolDeps } from "./tools.js";
import { describeError } from "../logger.js";

/**
 * The conversational agent.
 *
 * Mastra supplies the loop, the tool protocol and the approval rendering;
 * Nebius supplies the model through its OpenAI-compatible endpoint. The
 * interesting design decision is what is *not* here: no memory of figures, no
 * ability to dial, and no path to a side effect that does not pass through a
 * stored decision. The agent is a good explainer wired to a careful system.
 */

export interface CoordinatorAgent {
  ask(input: {
    message: string;
    conversationId: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ text: string; toolsUsed: string[] }>;
  readonly available: boolean;
}

export function createCoordinatorAgent(deps: ToolDeps): CoordinatorAgent {
  if (!env.nebius.apiKey) {
    return {
      available: false,
      async ask() {
        return {
          text: "The assistant is not configured (NEBIUS_API_KEY is unset), so I cannot answer questions. The ranked list and the map are unaffected.",
          toolsUsed: [],
        };
      },
    };
  }

  const agent = new Agent({
    id: "arca-coordinator",
    name: "ARCA",
    description: "Wildfire values-at-risk coordinator assistant.",
    instructions: coordinatorInstructions(),
    model: {
      // Mastra accepts an OpenAI-compatible descriptor, which is exactly what
      // Nebius Token Factory serves. No provider shim in between.
      providerId: "nebius",
      modelId: env.nebius.model,
      url: env.nebius.baseUrl,
      apiKey: env.nebius.apiKey,
    },
    tools: buildTools(deps),
  });

  return {
    available: true,
    async ask(input) {
      // Each item needs a literal role, not a union, or the message type does
      // not narrow to Mastra's user/assistant message shapes.
      const messages = [
        ...(input.history ?? []).slice(-10).map((turn) =>
          turn.role === "user"
            ? { role: "user" as const, content: turn.content }
            : { role: "assistant" as const, content: turn.content },
        ),
        { role: "user" as const, content: input.message },
      ];

      try {
        const result = await agent.generate(messages, {
          // Enough steps to look something up, check a second thing, then
          // answer. More than that is a model going in circles, and a
          // coordinator waiting on a phone will not wait for it.
          maxSteps: 6,
          modelSettings: { temperature: 0.3 },
        });

        const text = (result as { text?: string }).text?.trim() ?? "";
        const toolCalls = (result as { toolCalls?: Array<{ toolName?: string }> }).toolCalls ?? [];
        return {
          text: text || "I could not put an answer together. Ask again, or check the ranked list on the map.",
          toolsUsed: toolCalls.map((call) => call.toolName ?? "unknown"),
        };
      } catch (error) {
        const message = describeError(error);
        deps.ctx.log.error("Agent turn failed", { error: message });
        return {
          text: `I could not answer that: ${message}. The ranked list and the map are still live.`,
          toolsUsed: [],
        };
      }
    },
  };
}
