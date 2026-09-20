"use client";

import type { TimelineEvent } from "@arca/core";
import { timeOfDay } from "@/lib/format";

/**
 * What happened, in order.
 *
 * This is the audit trail rendered for a human. Every approval, every call,
 * every degraded upstream and every re-rank lands here with a timestamp and an
 * actor, which is what makes "defend the decision you made at 14:20" a
 * question with an answer.
 */

const KIND_COLOUR: Record<string, string> = {
  detected: "var(--color-ink-faint)",
  confirmed: "var(--color-evacuate)",
  simulation_requested: "var(--color-ink-faint)",
  simulation_completed: "var(--color-ok)",
  simulation_failed: "var(--color-warn)",
  exposure_computed: "var(--color-ok)",
  exposure_degraded: "var(--color-warn)",
  ranked: "var(--color-ink)",
  reranked: "var(--color-resource)",
  briefed: "var(--color-ink-dim)",
  approval_requested: "var(--color-prepare)",
  approved: "var(--color-ok)",
  denied: "var(--color-ink-faint)",
  call_dispatched: "var(--color-resource)",
  call_failed: "var(--color-evacuate)",
  call_completed: "var(--color-ok)",
  report_extracted: "var(--color-shelter)",
  status_changed: "var(--color-ink-dim)",
  note: "var(--color-ink-faint)",
};

export function EventFeed(props: { events: TimelineEvent[]; limit?: number }) {
  const events = [...props.events].reverse().slice(0, props.limit ?? 60);

  if (events.length === 0) {
    return (
      <p className="text-[11px] text-[var(--color-ink-faint)] px-1">Nothing has happened yet.</p>
    );
  }

  return (
    <ol className="space-y-2.5">
      {events.map((event) => (
        <li key={event.id} className="enter flex gap-2.5 text-[11px] leading-relaxed">
          <span className="num shrink-0 text-[var(--color-ink-faint)] pt-[1px]">
            {timeOfDay(event.at)}
          </span>
          <span
            className="shrink-0 w-1 rounded-full mt-[5px] mb-[3px]"
            style={{ background: KIND_COLOUR[event.kind] ?? "var(--color-ink-faint)" }}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-[var(--color-ink-dim)] whitespace-pre-wrap break-words">
              {event.message}
            </p>
            {event.actor !== "system" ? (
              <span className="text-[10px] text-[var(--color-ink-faint)]">{event.actor}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
