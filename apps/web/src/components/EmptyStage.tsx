"use client";

import { BrandMark } from "./Brand";
import type { Mode } from "@/lib/api";

/**
 * What the map shows before a fire is chosen.
 *
 * A wildfire system spends most of its life with nothing to show, and the
 * honest version of that is not an empty rectangle. This says what ARCA does,
 * what the feed on the left currently holds, and — when the live feed is empty
 * — offers the one thing that is always available.
 */

export interface EmptyStageProps {
  mode: Mode;
  loading: boolean;
  error: string | null;
  clusterCount: number;
  scenarioCount: number;
  onSwitchMode: () => void;
}

export function EmptyStage(props: EmptyStageProps) {
  // "No fires" and "no fires ARCA believes in" are different claims; the rail
  // draws the distinction, and this must not contradict it.
  const liveEmpty = props.mode === "live" && props.clusterCount === 0 && !props.loading;

  return (
    <div className="absolute inset-0 grid place-items-center px-8">
      <div className="max-w-[440px] text-center">
        <div className="flex justify-center mb-4 opacity-80">
          <BrandMark size={44} />
        </div>

        <h2 className="text-[17px] text-[var(--color-ink)]" style={{ letterSpacing: "0.1em" }}>
          ARCA
        </h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--color-ink-dim)]">
          DeepFire says where a fire may go. Talaia says what is there. ARCA says who to call
          first, calls them once you approve, and re-ranks on what they say.
        </p>

        {props.error ? (
          <p className="mt-4 text-[11px] text-[var(--color-evacuate)]">{props.error}</p>
        ) : null}

        <p className="mt-5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
          {props.loading ? (
            "Reading the feed…"
          ) : liveEmpty ? (
            <>
              Nothing is burning in the area of interest right now, which is the expected state
              most of the time.
            </>
          ) : props.mode === "live" ? (
            <>
              {props.clusterCount} active cluster{props.clusterCount === 1 ? "" : "s"} on the left,
              each scored. Pick one to run the full pipeline on it.
            </>
          ) : (
            <>
              {props.scenarioCount} scenario{props.scenarioCount === 1 ? "" : "s"} on the left, each
              one generated and labelled as such. Pick one to see the whole system work.
            </>
          )}
        </p>

        {liveEmpty ? (
          <button
            type="button"
            onClick={props.onSwitchMode}
            className="mt-4 text-[11.5px] px-3 py-1.5 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors"
          >
            Work a synthetic scenario instead
          </button>
        ) : null}

        <p className="mt-8 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
          Capacity figures are registered maximums, not live occupancy. Valuations are parametric
          replacement-cost estimates for triage, not appraisals. ARCA never places a call without a
          recorded human approval.
        </p>
      </div>
    </div>
  );
}
