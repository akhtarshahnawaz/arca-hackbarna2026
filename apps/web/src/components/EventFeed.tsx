"use client";

import { useMemo } from "react";
import type { TimelineEvent } from "@arca/core";
import { timeOfDay } from "@/lib/format";

/**
 * What happened, in order, in words.
 *
 * This is the audit trail — every approval, every call, every degraded upstream
 * and every re-rank, with a timestamp and an actor, which is what makes
 * "defend the decision you made at 14:20" a question with an answer.
 *
 * It used to render that as a flat list of raw event text, which is an audit
 * log rather than a feed: correct, complete, and unreadable at a glance. Two
 * changes. Each event now carries a short label saying what *kind* of thing
 * happened, so the column can be skimmed by shape before it is read. And
 * anything a person did is marked as such — the difference between "the system
 * did this" and "someone decided this" is the whole point of keeping the log.
 */

interface Style {
  label: string;
  colour: string;
  /** True when a human caused it. Those get a heavier mark. */
  human?: boolean;
}

const STYLE: Record<string, Style> = {
  detected: { label: "Detected", colour: "var(--color-ink-faint)" },
  confirmed: { label: "Confirmed", colour: "var(--color-evacuate)" },
  simulation_requested: { label: "Model queued", colour: "var(--color-ink-faint)" },
  simulation_completed: { label: "Model done", colour: "var(--color-ok)" },
  simulation_failed: { label: "Model failed", colour: "var(--color-warn)" },
  exposure_queried: { label: "Asking Talaia", colour: "var(--color-ink-faint)" },
  exposure_computed: { label: "Exposure", colour: "var(--color-ok)" },
  exposure_degraded: { label: "Degraded", colour: "var(--color-warn)" },
  ranked: { label: "Ranked", colour: "var(--color-ink)" },
  reranked: { label: "Re-ranked", colour: "var(--color-resource)" },
  briefed: { label: "Briefed", colour: "var(--color-ink-dim)" },
  approval_requested: { label: "Asked to approve", colour: "var(--color-prepare)" },
  approved: { label: "Approved", colour: "var(--color-ok)", human: true },
  denied: { label: "Denied", colour: "var(--color-ink-faint)", human: true },
  call_dispatched: { label: "Calling", colour: "var(--color-resource)" },
  call_failed: { label: "No call", colour: "var(--color-evacuate)" },
  call_completed: { label: "Call ended", colour: "var(--color-ok)" },
  report_extracted: { label: "Site reported", colour: "var(--color-shelter)" },
  status_changed: { label: "Status", colour: "var(--color-ink-dim)" },
  note: { label: "Note", colour: "var(--color-ink-faint)" },
};

const FALLBACK: Style = { label: "Event", colour: "var(--color-ink-faint)" };

/** Minutes between events before the feed breaks them into separate runs. */
const GAP_MINUTES = 4;

export function EventFeed(props: { events: TimelineEvent[]; limit?: number; dense?: boolean }) {
  const events = useMemo(
    () => [...props.events].reverse().slice(0, props.limit ?? 80),
    [props.events, props.limit],
  );

  if (events.length === 0) {
    return (
      <div className="px-1 py-2">
        <p className="text-[11px] text-[var(--color-ink-dim)]">Nothing has happened yet.</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
          Everything ARCA does to this fire lands here — what it detected, what it asked the model,
          who approved a call, and what a site said back. It is the record you would defend a
          decision with.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-1">
      {events.map((event, index) => {
        const style = STYLE[event.kind] ?? FALLBACK;
        const previous = events[index - 1];
        // A visible break wherever the incident went quiet, so bursts of
        // machine work read as one moment rather than fifteen.
        const gap =
          previous &&
          Math.abs(Date.parse(previous.at) - Date.parse(event.at)) > GAP_MINUTES * 60_000;
        const byPerson = style.human || (event.actor !== "system" && event.actor !== "replay");

        return (
          <li key={event.id} className={gap ? "pt-2 mt-2 border-t hairline" : undefined}>
            <div className="enter flex gap-2 text-[11px] leading-relaxed">
              <span className="num shrink-0 w-[34px] text-[10px] text-[var(--color-ink-faint)] pt-[2px]">
                {timeOfDay(event.at)}
              </span>

              <span
                className="shrink-0 w-[2px] rounded-full mt-[5px] mb-[3px]"
                style={{ background: style.colour, opacity: byPerson ? 1 : 0.55 }}
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span
                    className="text-[9px] uppercase tracking-[0.06em] shrink-0"
                    style={{ color: style.colour }}
                  >
                    {style.label}
                  </span>
                  {byPerson ? (
                    <span
                      className="text-[9px] px-1 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-dim)]"
                      title="A person did this, and the record names them."
                    >
                      {event.actor}
                    </span>
                  ) : null}
                </div>
                <p className="text-[var(--color-ink-dim)] whitespace-pre-wrap break-words">
                  {event.message}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
