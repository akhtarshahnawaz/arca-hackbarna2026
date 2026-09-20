"use client";

import type { Mode } from "@/lib/api";

/**
 * Live or synthetic.
 *
 * The single most important thing on this screen to get right, because it is
 * the difference between "eight hundred people are in the path of this fire"
 * and "eight hundred imaginary people are in the path of an imaginary fire".
 * Anyone glancing at the display from across a room has to be able to tell
 * which of those they are looking at, so the control is central, always
 * visible, and the synthetic side carries its own colour and a live badge on
 * every incident opened from it.
 *
 * It is never set automatically. A deployment with no DeepFire credentials
 * opens in synthetic mode and says why, rather than quietly pretending.
 */

export interface ModeSwitchProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
  /** Live is offered but explained when DeepFire is not configured. */
  liveAvailable: boolean;
}

const COPY: Record<Mode, { label: string; help: string }> = {
  live: {
    label: "Live",
    help: "Real clusters from DeepFire, real exposure from Talaia, right now.",
  },
  synthetic: {
    label: "Synthetic",
    help: "Generated scenarios through the identical pipeline. Nothing here is a real fire.",
  },
};

export function ModeSwitch(props: ModeSwitchProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Data mode"
      className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-line)]"
    >
      {(["live", "synthetic"] as const).map((value) => {
        const active = props.mode === value;
        const disabled = value === "live" && !props.liveAvailable;
        const accent = value === "live" ? "var(--color-ok)" : "var(--color-resource)";
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${COPY[value].label} data`}
            disabled={disabled}
            onClick={() => props.onChange(value)}
            title={
              disabled
                ? "DeepFire credentials are not configured on this deployment, so there is no live feed."
                : COPY[value].help
            }
            className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[11.5px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-[var(--color-surface-3)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 transition-colors"
              style={{ background: active ? accent : "var(--color-line-bright)" }}
            />
            {COPY[value].label}
          </button>
        );
      })}
    </div>
  );
}
