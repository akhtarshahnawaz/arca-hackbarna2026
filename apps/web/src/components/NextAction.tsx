"use client";

import type { RankedSite, SiteStatus } from "@arca/core";
import { ACTION_STYLE, minutes } from "@/lib/format";

/**
 * The answer, before the evidence.
 *
 * Everything else on this screen is support for one decision: who to contact
 * first. An earlier version gave that row the same weight as eight others and
 * a dozen aggregate figures, which is how a coordinator ends up reading a
 * dashboard instead of making a call.
 *
 * One site, one instruction, the reason in a sentence, and the button that acts
 * on it.
 */

export interface NextActionProps {
  site: RankedSite | null;
  totalRanked: number;
  onApprove: (site: RankedSite) => void;
  onSetStatus: (site: RankedSite, status: SiteStatus) => void;
  onSelect: (assetId: string) => void;
  busy: boolean;
  canCall: boolean;
}

export function NextAction(props: NextActionProps) {
  const { site } = props;

  if (!site) {
    return (
      <section className="panel px-4 py-5">
        <p className="text-[13px] text-[var(--color-ink-dim)]">
          Nothing needs a call right now.
        </p>
        <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
          A site appears here as soon as one runs short of time.
        </p>
      </section>
    );
  }

  const style = ACTION_STYLE[site.action];
  const outOfTime = site.spareMinutes !== null && site.spareMinutes < 0;
  const settled = site.status === "evacuated" || site.status === "do_not_call";

  return (
    <section
      className="panel relative overflow-hidden"
      style={{ borderColor: `${style.colour}55` }}
      aria-label="Next action"
    >
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: style.colour }} />

      <div className="pl-4 pr-4 py-3.5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
            Call first
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: `${style.colour}1f`, color: style.colour, border: `1px solid ${style.colour}44` }}
          >
            {style.short}
          </span>
        </div>

        <button
          type="button"
          onClick={() => props.onSelect(site.assetId)}
          className="text-left w-full"
        >
          <h2 className="text-[19px] leading-tight text-[var(--color-ink)] hover:underline decoration-[var(--color-line-bright)]">
            {site.name}
          </h2>
        </button>

        {/* The whole argument, in one sentence a tired person can act on. */}
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-ink-dim)]">
          {site.peopleEstimate > 0 ? (
            <>
              <span className="num text-[var(--color-ink)]">{site.peopleEstimate}</span>{" "}
              {site.evac.basis === "reported" ? "people reported on site" : "people at capacity"}
              {site.livestockUnits ? (
                <>
                  {" "}and <span className="num text-[var(--color-ink)]">{site.livestockUnits}</span> animals
                </>
              ) : null}
              .{" "}
            </>
          ) : null}
          {site.arrivalMinutes !== null ? (
            <>
              Fire in <span className="num text-[var(--color-ink)]">{minutes(site.arrivalMinutes)}</span>;
              moving them takes <span className="num text-[var(--color-ink)]">{minutes(site.evac.minutes)}</span>.
            </>
          ) : (
            <>No arrival time inside the horizon.</>
          )}
        </p>

        {outOfTime ? (
          <p
            className="mt-2 text-[11px] leading-relaxed rounded px-2.5 py-1.5"
            style={{ background: `${style.colour}14`, color: style.colour }}
          >
            Short by {minutes(Math.abs(site.spareMinutes ?? 0))}. Evacuation probably cannot finish
            before the front arrives — this is urgency, not an order. Decide with Bombers.
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          {settled ? (
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              Marked {site.status.replace(/_/g, " ")}.
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={props.busy || !props.canCall}
                onClick={() => props.onApprove(site)}
                title={
                  props.canCall
                    ? "Records the approval, then places the call"
                    : "Voice is not configured on this deployment"
                }
                className="text-[12px] px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-40"
                style={{ background: `${style.colour}22`, color: style.colour, border: `1px solid ${style.colour}66` }}
              >
                {props.busy ? "Calling…" : "Approve call"}
              </button>
              <button
                type="button"
                disabled={props.busy}
                onClick={() => props.onSetStatus(site, "evacuated")}
                className="text-[12px] px-2.5 py-1.5 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
              >
                Already clear
              </button>
            </>
          )}
          {props.totalRanked > 1 ? (
            <span className="ml-auto text-[10px] text-[var(--color-ink-faint)]">
              {props.totalRanked - 1} more below
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * The scale of it, in one line.
 *
 * Three figures, not nine. The rest stay one click away in the site detail,
 * where they answer a question someone has actually asked.
 */
export function ImpactStrip(props: {
  people: number;
  sites: number;
  outOfTime: number;
  hour: number | null;
  horizonHours: number;
}) {
  return (
    <div className="panel px-4 py-2.5 flex items-center gap-4">
      <Figure value={props.people.toLocaleString("en-GB")} label="people" />
      <Divider />
      <Figure value={String(props.sites)} label="sites" />
      <Divider />
      <Figure
        value={String(props.outOfTime)}
        label="out of time"
        colour={props.outOfTime > 0 ? "var(--color-shelter)" : undefined}
      />
      <span className="ml-auto text-[10px] text-right text-[var(--color-ink-faint)] leading-tight">
        {props.hour === null ? `next ${props.horizonHours} h` : `first ${props.hour} h`}
        <br />
        registered capacity
      </span>
    </div>
  );
}

function Figure(props: { value: string; label: string; colour?: string }) {
  return (
    <div>
      <div className="num text-[19px] leading-none" style={{ color: props.colour ?? "var(--color-ink)" }}>
        {props.value}
      </div>
      <div className="mt-0.5 text-[9.5px] uppercase tracking-[0.08em] text-[var(--color-ink-faint)]">
        {props.label}
      </div>
    </div>
  );
}

function Divider() {
  return <span className="w-px h-7 bg-[var(--color-line)]" aria-hidden="true" />;
}
