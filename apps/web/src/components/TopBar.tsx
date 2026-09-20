"use client";

import type { Incident } from "@arca/core";
import { Brand } from "./Brand";
import { ModeSwitch } from "./ModeSwitch";
import type { Mode, SpreadView } from "@/lib/api";
import { timeOfDay } from "@/lib/format";

/**
 * The top bar.
 *
 * Three things, in the order someone needs them: who this is, which world they
 * are looking at, and which fire is on screen. Everything else that used to
 * live here — detection counts, satellite counts, wind, burned area — moved to
 * where it is actually used. A header full of numbers nobody acts on is how a
 * screen stops being read at all.
 *
 * The confirmation score stays, because it is the only number that answers
 * "why am I being shown this at all", and it opens to show the rules that
 * produced it.
 */

export interface TopBarProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  liveAvailable: boolean;
  incident: Incident | null;
  spread: SpreadView | null;
  live: boolean;
  exerciseMode: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

export function TopBar(props: TopBarProps) {
  const { incident } = props;

  return (
    <header className="panel px-3 py-2 flex items-center gap-4">
      <Brand />

      <div className="mx-auto">
        <ModeSwitch mode={props.mode} onChange={props.onModeChange} liveAvailable={props.liveAvailable} />
      </div>

      {incident ? (
        <div className="flex items-center gap-4 min-w-0 shrink">
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <h1 className="text-[13.5px] text-[var(--color-ink)] truncate">{incident.name}</h1>
              {incident.replay ? (
                <span
                  className="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    color: "var(--color-resource)",
                    background: "color-mix(in oklab, var(--color-resource) 12%, transparent)",
                    border: "1px solid color-mix(in oklab, var(--color-resource) 28%, transparent)",
                  }}
                >
                  synthetic
                </span>
              ) : null}
              {props.exerciseMode ? (
                <span className="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-warn)]/40 text-[var(--color-warn)]">
                  exercise
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--color-ink-faint)] truncate">
              {incident.status} · last seen {timeOfDay(incident.lastObserved)}Z
              {props.spread?.windSpeedMs
                ? ` · wind ${Math.round(props.spread.windSpeedMs)} m/s`
                : ""}
            </div>
          </div>

          <ScoreBadge
            score={incident.confirmation.score}
            components={incident.confirmation.components}
          />
        </div>
      ) : null}

      <div className="flex items-center gap-3 shrink-0">
        <span
          className="flex items-center gap-1.5 text-[10px]"
          title={props.live ? "Receiving live updates" : "Live updates disconnected"}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: props.live ? "var(--color-ok)" : "var(--color-ink-faint)" }}
          />
          <span className="text-[var(--color-ink-faint)]">{props.live ? "live" : "offline"}</span>
        </span>
        {incident ? (
          <button
            type="button"
            onClick={props.onRefresh}
            disabled={props.refreshing}
            className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-40"
            title="Ask DeepFire for a fresh simulation and re-rank on it"
          >
            {props.refreshing ? "Re-running…" : "Re-run model"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function ScoreBadge(props: { score: number; components: Incident["confirmation"]["components"] }) {
  const tone =
    props.score >= 60
      ? "var(--color-evacuate)"
      : props.score >= 30
        ? "var(--color-warn)"
        : "var(--color-monitor)";

  return (
    <div className="group relative shrink-0">
      <div className="flex items-baseline gap-1 cursor-help">
        <span className="num text-xl leading-none" style={{ color: tone }}>
          {props.score}
        </span>
        <span className="text-[9.5px] text-[var(--color-ink-faint)]">/100</span>
      </div>

      <div className="pointer-events-none absolute right-0 top-full mt-2 z-30 w-[330px] opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="panel bg-[var(--color-surface-2)] p-3 shadow-2xl text-left">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] mb-2">
            Why ARCA believes this is a fire
          </div>
          <ul className="space-y-1.5">
            {props.components.map((component) => (
              <li key={component.key} className="flex gap-2 text-[11px]">
                <span
                  className="num w-8 shrink-0 text-right"
                  style={{ color: component.points >= 0 ? "var(--color-ok)" : "var(--color-evacuate)" }}
                >
                  {component.points >= 0 ? "+" : ""}
                  {component.points}
                </span>
                <span className="text-[var(--color-ink-dim)]">
                  <span className="text-[var(--color-ink)]">{component.label}.</span>{" "}
                  {component.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
