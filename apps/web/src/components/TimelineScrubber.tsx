"use client";

import { useEffect, useRef, useState } from "react";
import type { SpreadFrameView } from "@/lib/api";
import { areaKm2, compact } from "@/lib/format";

/**
 * Playback for the fire.
 *
 * The scrubber exists because a static footprint answers "how big" and a
 * coordinator is asking "how fast". Watching the 0.9 core push into a village
 * between t+2h and t+3h communicates something a polygon does not.
 *
 * It loops rather than stopping at the end: a wall display left alone should
 * keep showing the fire moving, not freeze on the last frame looking broken.
 *
 * The consequence figures live here rather than in the side panel, because
 * they are a function of the hour this control selects. Dragging to +3h and
 * watching "people" climb is the whole argument for having a scrubber; the
 * same three numbers sitting in a separate box read as static trivia.
 */

export interface TimelineScrubberProps {
  frames: SpreadFrameView[];
  hour: number | null;
  onChange: (hour: number | null) => void;
  disabled?: boolean;
  /** What is inside the footprint at the selected hour. */
  impact: { people: number; sites: number; outOfTime: number } | null;
}

const STEP_MS = 900;

export function TimelineScrubber(props: TimelineScrubberProps) {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hours = props.frames.map((frame) => frame.hour);
  const maxHour = hours.length > 0 ? Math.max(...hours) : 0;

  useEffect(() => {
    if (!playing || props.disabled || maxHour === 0) return;
    timerRef.current = setInterval(() => {
      props.onChange(nextHour(props.hour, maxHour));
    }, STEP_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, props.hour, props.disabled, maxHour, props]);

  useEffect(() => {
    if (props.disabled) setPlaying(false);
  }, [props.disabled]);

  const current = props.hour;
  const frame = props.frames.find((candidate) => candidate.hour === current) ?? null;

  if (maxHour === 0) {
    return (
      <div className="panel px-4 py-3 flex items-center gap-4">
        <span className="text-[11px] text-[var(--color-ink-faint)]">
          No model frames to play. The map shows detections only.
        </span>
        {props.impact ? <Impact {...props.impact} hour={null} /> : null}
      </div>
    );
  }

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => {
            if (!playing && current === null) props.onChange(1);
            setPlaying(!playing);
          }}
          disabled={props.disabled}
          aria-label={playing ? "Pause" : "Play the fire spread"}
          className="shrink-0 w-9 h-9 rounded-full grid place-items-center border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-40"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div className="flex-1">
          <div className="flex items-center gap-1">
            {props.frames.map((item) => {
              const active = current === null || item.hour <= current;
              const isCurrent = current === item.hour;
              return (
                <button
                  key={item.hour}
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    props.onChange(item.hour);
                  }}
                  aria-label={`Show hour ${item.hour}`}
                  aria-current={isCurrent}
                  className="group flex-1 flex flex-col gap-1.5 items-stretch"
                >
                  <span
                    className="h-1.5 rounded-full transition-all duration-300"
                    style={{
                      background: active
                        ? isCurrent
                          ? "var(--color-evacuate)"
                          : "color-mix(in oklab, var(--color-evacuate) 45%, transparent)"
                        : "var(--color-line-bright)",
                      transform: isCurrent ? "scaleY(1.6)" : "scaleY(1)",
                    }}
                  />
                  <span
                    className={`num text-[10px] transition-colors ${
                      isCurrent
                        ? "text-[var(--color-ink)]"
                        : "text-[var(--color-ink-faint)] group-hover:text-[var(--color-ink-dim)]"
                    }`}
                  >
                    +{item.hour}h
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 w-[128px] text-right">
          <div className="num text-[13px] text-[var(--color-ink)]">
            {frame ? areaKm2(frame.cumulativeAreaM2) : "whole horizon"}
          </div>
          <div className="text-[9.5px] text-[var(--color-ink-faint)]">
            {frame ? `expected burn ${areaKm2(frame.expectedAreaM2)}` : `over ${maxHour} h`}
          </div>
        </div>

        {props.impact ? (
          <>
            <span className="w-px h-8 bg-[var(--color-line)] shrink-0" aria-hidden="true" />
            <Impact {...props.impact} hour={current} />
          </>
        ) : null}

        {current !== null ? (
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              props.onChange(null);
            }}
            className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
          >
            all
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What is inside the footprint, at the hour on the slider.
 *
 * Three figures. Earlier versions showed nine, which meant a coordinator had
 * to decide which of nine numbers mattered before they could use any of them.
 */
function Impact(props: {
  people: number;
  sites: number;
  outOfTime: number;
  hour: number | null;
}) {
  return (
    <div className="shrink-0 flex items-center gap-4">
      <Figure value={compact(props.people)} label="people" />
      <Figure value={String(props.sites)} label="sites" />
      <Figure
        value={String(props.outOfTime)}
        label="out of time"
        colour={props.outOfTime > 0 ? "var(--color-shelter)" : undefined}
      />
      <span className="text-[9px] text-[var(--color-ink-faint)] leading-tight max-w-[86px]">
        {props.hour === null ? "whole horizon" : `by +${props.hour} h`}
        <br />
        capacity, not occupancy
      </span>
    </div>
  );
}

function Figure(props: { value: string; label: string; colour?: string }) {
  return (
    <div>
      <div className="num text-[17px] leading-none" style={{ color: props.colour ?? "var(--color-ink)" }}>
        {props.value}
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-[0.06em] text-[var(--color-ink-faint)]">
        {props.label}
      </div>
    </div>
  );
}

/** Loop back to the first hour so an unattended display keeps moving. */
function nextHour(current: number | null, maxHour: number): number {
  if (current === null) return 1;
  return current >= maxHour ? 1 : current + 1;
}

function PlayIcon() {
  return (
    <svg width="12" height="13" viewBox="0 0 12 13" fill="none" aria-hidden="true">
      <path d="M2 1.5v10l9-5-9-5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="3.2" height="12" rx="1" fill="currentColor" />
      <rect x="6.8" y="0" width="3.2" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}
