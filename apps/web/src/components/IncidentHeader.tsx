"use client";

import type { Incident } from "@arca/core";
import type { SpreadView } from "@/lib/api";
import { compact, timeOfDay } from "@/lib/format";

/**
 * The header.
 *
 * Shows the confirmation score with the evidence that produced it, because a
 * system that wakes someone at 3 a.m. owes them the reason. The components are
 * expandable rather than hidden: a coordinator who disagrees with the threshold
 * can see exactly which rule fired.
 */

export interface IncidentHeaderProps {
  incident: Incident;
  spread: SpreadView | null;
  live: boolean;
  exerciseMode: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}

export function IncidentHeader(props: IncidentHeaderProps) {
  const { incident } = props;
  const score = incident.confirmation.score;
  const tone = score >= 60 ? "var(--color-evacuate)" : score >= 30 ? "var(--color-warn)" : "var(--color-monitor)";

  return (
    <header className="panel px-4 py-3 flex items-center gap-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-base text-[var(--color-ink)] truncate">{incident.name}</h1>
          {incident.replay ? (
            <span className="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-dim)]">
              replay
            </span>
          ) : null}
          {props.exerciseMode ? (
            <span className="shrink-0 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-[var(--color-warn)]/40 text-[var(--color-warn)]">
              exercise
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
          {incident.status} · first seen {timeOfDay(incident.firstObserved)}Z · last{" "}
          {timeOfDay(incident.lastObserved)}Z
        </div>
      </div>

      <ScoreBadge score={score} tone={tone} components={incident.confirmation.components} />

      <Stat
        label="satellites"
        value={String(incident.confirmation.distinctSources.length)}
        detail={incident.confirmation.distinctSources.join(", ") || "none"}
      />
      <Stat
        label="detections"
        value={compact(incident.confirmation.usableHotspots)}
        detail={
          incident.confirmation.maskedHotspots > 0
            ? `${incident.confirmation.maskedHotspots} masked as known heat sources`
            : "none masked"
        }
      />
      {incident.confirmation.maxFrpMw ? (
        <Stat
          label="peak FRP"
          value={`${Math.round(incident.confirmation.maxFrpMw)}`}
          detail="megawatts, strongest pixel"
        />
      ) : null}
      {props.spread?.windSpeedMs ? (
        <Stat
          label="wind"
          value={`${Math.round(props.spread.windSpeedMs)} m/s`}
          detail={
            props.spread.windDirectionDeg !== null
              ? `from ${Math.round(props.spread.windDirectionDeg)}°, model average`
              : "model average"
          }
        />
      ) : null}

      <div className="ml-auto flex items-center gap-3 shrink-0">
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
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.refreshing}
          className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-40"
          title="Ask DeepFire for a fresh simulation and re-rank on it"
        >
          {props.refreshing ? "Re-running…" : "Re-run model"}
        </button>
      </div>
    </header>
  );
}

function ScoreBadge(props: {
  score: number;
  tone: string;
  components: Incident["confirmation"]["components"];
}) {
  return (
    <div className="group relative shrink-0">
      <div className="flex items-baseline gap-1.5 cursor-help">
        <span className="num text-2xl leading-none" style={{ color: props.tone }}>
          {props.score}
        </span>
        <span className="text-[10px] text-[var(--color-ink-faint)]">/100 confirmed</span>
      </div>

      <div className="pointer-events-none absolute left-0 top-full mt-2 z-30 w-[320px] opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="panel bg-[var(--color-surface-2)] p-3 shadow-2xl">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] mb-2">
            How this was scored
          </div>
          <ul className="space-y-1.5">
            {props.components.map((component) => (
              <li key={component.key} className="flex gap-2 text-[11px]">
                <span
                  className="num w-8 shrink-0 text-right"
                  style={{
                    color: component.points >= 0 ? "var(--color-ok)" : "var(--color-evacuate)",
                  }}
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

function Stat(props: { label: string; value: string; detail: string }) {
  return (
    <div className="shrink-0" title={props.detail}>
      <div className="num text-sm text-[var(--color-ink)]">{props.value}</div>
      <div className="text-[10px] text-[var(--color-ink-faint)]">{props.label}</div>
    </div>
  );
}
