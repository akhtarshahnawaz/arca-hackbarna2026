"use client";

import type { SpreadView } from "@/lib/api";
import { ACTION_STYLE, BURN_RAMP } from "@/lib/format";

/**
 * The legend.
 *
 * Present because the map uses colour to carry two different meanings at once —
 * probability for the fire, instruction for the assets — and an unlabelled
 * colour is a guess. The probability stops are phrased as runs rather than
 * percentages ("2 in 10 runs") because that is how the uncertainty was
 * generated and how the agent talks about it.
 */

export function Legend(props: {
  spread: SpreadView | null;
  showMasked: boolean;
  showAssets: boolean;
  onToggleMasked: () => void;
  onToggleAssets: () => void;
  maskedCount: number;
}) {
  const members = props.spread?.ensembleMembers ?? 10;

  return (
    <div className="panel bg-[var(--color-surface)]/92 backdrop-blur px-3 py-2.5 text-[10px] w-[218px]">
      <div className="uppercase tracking-[0.1em] text-[var(--color-ink-faint)] mb-1.5">
        {props.spread?.synthetic ? "Footprint" : "Chance of burning"}
      </div>

      {props.spread?.synthetic ? (
        <p className="text-[var(--color-warn)] leading-relaxed mb-2">
          No usable model output. This is a ring drawn around the fire, not a prediction.
        </p>
      ) : (
        <div className="flex items-center gap-0.5 mb-1">
          {BURN_RAMP.map(([stop, colour]) => (
            <div key={stop} className="flex-1">
              <div className="h-2 rounded-sm" style={{ background: colour }} />
              <div className="num mt-1 text-[9px] text-[var(--color-ink-faint)] text-center">
                {Math.round(stop * members)}
              </div>
            </div>
          ))}
        </div>
      )}
      {props.spread?.synthetic ? null : (
        <div className="text-[9px] text-[var(--color-ink-faint)] mb-2.5">
          runs out of {members} that reach it
        </div>
      )}

      <div className="uppercase tracking-[0.1em] text-[var(--color-ink-faint)] mb-1.5 pt-1 border-t hairline">
        Recommended action
      </div>
      <ul className="space-y-1 mb-2.5">
        {(["SHELTER_CANDIDATE", "EVACUATE_NOW", "EXCLUSION_ZONE", "PREPARE", "MONITOR"] as const).map(
          (action) => (
            <li key={action} className="flex items-center gap-1.5" title={ACTION_STYLE[action].help}>
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: ACTION_STYLE[action].colour }}
              />
              <span className="text-[var(--color-ink-dim)]">{ACTION_STYLE[action].label}</span>
            </li>
          ),
        )}
      </ul>

      <div className="pt-1.5 border-t hairline space-y-1">
        <Toggle label="Assets" on={props.showAssets} onClick={props.onToggleAssets} />
        <Toggle
          label={`Masked detections (${props.maskedCount})`}
          on={props.showMasked}
          onClick={props.onToggleMasked}
          help="Detections excluded as known persistent heat sources — flares, kilns, quarries. Shown hollow."
        />
      </div>
    </div>
  );
}

function Toggle(props: { label: string; on: boolean; onClick: () => void; help?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.help}
      className="w-full flex items-center gap-1.5 text-left hover:text-[var(--color-ink)] transition-colors"
      aria-pressed={props.on}
    >
      <span
        className="w-6 h-3 rounded-full relative transition-colors shrink-0"
        style={{ background: props.on ? "var(--color-line-bright)" : "var(--color-surface-3)" }}
      >
        <span
          className="absolute top-0.5 w-2 h-2 rounded-full bg-[var(--color-ink-dim)] transition-all"
          style={{ left: props.on ? "14px" : "2px" }}
        />
      </span>
      <span className="text-[var(--color-ink-dim)] truncate">{props.label}</span>
    </button>
  );
}
