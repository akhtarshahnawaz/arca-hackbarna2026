"use client";

import { useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";

/**
 * The assistant, as a thing you can find.
 *
 * It spent a build as the third tab in the side panel, next to "At risk" and
 * "Activity", and in that position nobody opened it — a tab is somewhere you
 * go when you have already decided to go there, and the whole point of an
 * assistant is that you reach for it mid-thought.
 *
 * So it is a button in the corner that opens over the map. The map keeps
 * rendering underneath, because half the questions worth asking are about
 * something you are looking at.
 */
export function AssistantDock(props: { incidentName: string | null; available: boolean }) {
  const [open, setOpen] = useState(false);

  // Escape closes it. A panel over the map that can only be dismissed by
  // finding its button again is a panel people leave open and then resent.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          props.available
            ? "Ask about this fire — why a site is first, what the model assumed, who to call"
            : "The assistant needs NEBIUS_API_KEY on the agent"
        }
        className={`absolute right-3 bottom-3 z-20 flex items-center gap-2 rounded-full pl-3.5 pr-4 py-2.5 transition-transform hover:scale-[1.03] active:scale-[0.99] ${
          props.available ? "assistant-call" : ""
        }`}
        style={{
          // Solid, warm and lit from inside, against a map that is mostly ash
          // and fire. A bordered dark pill in this corner was competing with a
          // legend, a caption and several hundred markers, and losing.
          background:
            "linear-gradient(135deg, color-mix(in oklab, var(--color-prepare) 92%, #fff 8%), var(--color-prepare))",
          color: "#1a1207",
          border: "1px solid color-mix(in oklab, var(--color-prepare) 70%, #fff 30%)",
          opacity: props.available ? 1 : 0.55,
        }}
      >
        <SparkIcon available={props.available} onDark />
        <span className="text-[12.5px] font-medium">Ask ARCA</span>
        {props.available ? (
          <span className="text-[9.5px] opacity-70">why is this first?</span>
        ) : (
          <span className="text-[9px] uppercase tracking-wider opacity-70">off</span>
        )}
      </button>
    );
  }

  return (
    <div className="absolute right-3 bottom-3 z-30 w-[380px] max-w-[calc(100%-1.5rem)] h-[460px] max-h-[calc(100%-1.5rem)] flex flex-col panel bg-[var(--color-surface)]/97 backdrop-blur shadow-2xl">
      <header className="flex items-center gap-2 px-3 py-2 border-b hairline">
        <SparkIcon available={props.available} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-[var(--color-ink)]">Ask ARCA</div>
          <div className="text-[9.5px] text-[var(--color-ink-faint)] truncate">
            {props.incidentName
              ? `About ${props.incidentName}. It answers from the ranking, never from memory.`
              : "Pick a fire and ask about it."}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the assistant"
          className="shrink-0 w-6 h-6 grid place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          ×
        </button>
      </header>

      <div className="flex-1 min-h-0 p-2">
        <ChatPanel incidentName={props.incidentName} available={props.available} />
      </div>

      <footer className="px-3 py-1.5 border-t hairline text-[9px] leading-snug text-[var(--color-ink-faint)]">
        It can raise an approval card. It cannot place a call.
      </footer>
    </div>
  );
}

function SparkIcon(props: { available: boolean; onDark?: boolean }) {
  const colour = props.onDark
    ? "#1a1207"
    : props.available
      ? "var(--color-prepare)"
      : "var(--color-ink-faint)";
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M8 1.6 9.5 6 14 7.5 9.5 9 8 13.4 6.5 9 2 7.5 6.5 6 8 1.6Z"
        fill={colour}
        opacity="0.9"
      />
    </svg>
  );
}
