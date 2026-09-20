"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

/**
 * Asking ARCA questions.
 *
 * The same agent the coordinator talks to on Telegram, so an answer given on a
 * phone and an answer given here come from one set of tools and one set of
 * instructions. The suggested questions are not decoration: they teach what the
 * system can be asked, which is most of what makes an assistant useful at all.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
}

const SUGGESTIONS = [
  "Who do we call first?",
  "Why is the care home ranked above the school?",
  "What does the model assume about evacuating a care home?",
  "Which sites are already out of time?",
];

export function ChatPanel(props: { incidentName: string | null; available: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    const history = turns.map((turn) => ({ role: turn.role, content: turn.content }));
    setTurns((previous) => [...previous, { role: "user", content: message }]);
    setBusy(true);
    try {
      const answer = await api.chat(message, history);
      setTurns((previous) => [
        ...previous,
        { role: "assistant", content: answer.text, tools: answer.toolsUsed },
      ]);
    } catch (error) {
      setTurns((previous) => [
        ...previous,
        {
          role: "assistant",
          content: `I could not reach the agent service: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-1 space-y-3">
        {turns.length === 0 ? (
          <div className="pt-1">
            <p className="text-[11px] text-[var(--color-ink-faint)] leading-relaxed">
              {props.available
                ? `Ask about ${props.incidentName ?? "an incident"}. Every figure comes from a tool call, and ARCA cannot place a call on its own.`
                : "The assistant is not configured on this deployment (NEBIUS_API_KEY is unset). The ranked list and the map are unaffected."}
            </p>
            {props.available ? (
              <div className="mt-3 flex flex-col gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="text-left text-[11px] px-2.5 py-1.5 rounded border border-[var(--color-line)] text-[var(--color-ink-dim)] hover:border-[var(--color-line-bright)] hover:text-[var(--color-ink)] transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {turns.map((turn, index) => (
          <div key={index} className="enter">
            {turn.role === "user" ? (
              <p className="text-[11px] text-[var(--color-ink-faint)]">{turn.content}</p>
            ) : (
              <div className="rounded-lg bg-[var(--color-surface-2)] border hairline px-3 py-2">
                <p className="text-[11px] leading-relaxed text-[var(--color-ink-dim)] whitespace-pre-wrap">
                  {turn.content}
                </p>
                {turn.tools && turn.tools.length > 0 ? (
                  <p className="mt-1.5 text-[10px] text-[var(--color-ink-faint)]">
                    via {turn.tools.join(", ")}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ))}

        {busy ? (
          <div className="relative overflow-hidden rounded-lg bg-[var(--color-surface-2)] border hairline px-3 py-2 sweep">
            <p className="text-[11px] text-[var(--color-ink-faint)]">Checking the tools…</p>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="mt-2 flex gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!props.available || busy}
          placeholder={props.available ? "Ask about this incident…" : "Assistant unavailable"}
          className="flex-1 min-w-0 text-[11px] px-2.5 py-2 rounded border border-[var(--color-line)] bg-[var(--color-surface-2)] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-line-bright)] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!props.available || busy || !draft.trim()}
          className="shrink-0 text-[11px] px-3 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
