"use client";

import type { RankedSite } from "@arca/core";
import { useCountUp, useExposureByHour } from "@/lib/api";
import { compact, euros } from "@/lib/format";

/**
 * What is at stake, at the hour the scrubber is showing.
 *
 * The figures count rather than jump, because the scrubber is showing a
 * consequence unfolding over six hours rather than a set of unrelated facts.
 *
 * Two rules this panel never breaks. People are never monetised: the euro
 * figure sits apart, styled as secondary, and the caption says what it is.
 * And facility occupancy is never added to resident population — they count
 * different people by different methods, and summing them would inflate the
 * one number a coordinator is most likely to repeat on the radio.
 */

export interface ImpactPanelProps {
  sites: RankedSite[];
  hour: number | null;
  horizonHours: number;
  populationResident: number | null;
  degraded?: boolean;
}

export function ImpactPanel(props: ImpactPanelProps) {
  const exposure = useExposureByHour(props.sites, props.hour);

  const people = useCountUp(exposure.people);
  const siteCount = useCountUp(exposure.count);
  const livestock = useCountUp(exposure.livestock);
  const value = useCountUp(exposure.value);
  const evacuate = useCountUp(exposure.evacuate);
  const shelter = useCountUp(exposure.shelter);

  const label =
    props.hour === null ? `next ${props.horizonHours} h` : `first ${props.hour} h`;

  return (
    <section className="panel p-4" aria-label="Impact">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
          At risk in the {label}
        </h2>
        {props.degraded ? (
          <span className="text-[10px] text-[var(--color-warn)]">partial data</span>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Figure
          value={compact(people)}
          label="people at facilities"
          caption="registered capacity"
          tone="ink"
        />
        <Figure value={compact(siteCount)} label="sites exposed" tone="ink" />
        <Figure
          value={compact(props.populationResident ?? 0)}
          label="residents in footprint"
          caption="census, counted separately"
          tone="dim"
        />
        <Figure
          value={compact(livestock)}
          label="livestock units"
          caption="cannot self-evacuate"
          tone="dim"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Pill
          value={Math.round(shelter)}
          label="out of time"
          colour="var(--color-shelter)"
          help="Evacuation probably cannot finish before the fire arrives."
        />
        <Pill
          value={Math.round(evacuate)}
          label="evacuate now"
          colour="var(--color-evacuate)"
          help="There is time, but movement has to start now."
        />
      </div>

      <div className="mt-4 pt-3 border-t hairline flex items-baseline justify-between">
        <span className="text-[11px] text-[var(--color-ink-faint)]">
          Replacement cost, triage estimate
        </span>
        <span className="num text-sm text-[var(--color-ink-dim)]">{euros(value)}</span>
      </div>
    </section>
  );
}

function Figure(props: {
  value: string;
  label: string;
  caption?: string;
  tone: "ink" | "dim";
}) {
  return (
    <div>
      <div
        className={`num text-[28px] leading-none ${
          props.tone === "ink" ? "text-[var(--color-ink)]" : "text-[var(--color-ink-dim)]"
        }`}
      >
        {props.value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--color-ink-dim)]">{props.label}</div>
      {props.caption ? (
        <div className="text-[10px] text-[var(--color-ink-faint)]">{props.caption}</div>
      ) : null}
    </div>
  );
}

function Pill(props: { value: number; label: string; colour: string; help: string }) {
  const active = props.value > 0;
  return (
    <div
      title={props.help}
      className="rounded-lg px-3 py-2 border transition-colors"
      style={{
        borderColor: active ? `${props.colour}66` : "var(--color-line)",
        background: active ? `${props.colour}14` : "transparent",
      }}
    >
      <div
        className="num text-xl leading-none"
        style={{ color: active ? props.colour : "var(--color-ink-faint)" }}
      >
        {props.value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-[var(--color-ink-dim)]">
        {props.label}
      </div>
    </div>
  );
}
