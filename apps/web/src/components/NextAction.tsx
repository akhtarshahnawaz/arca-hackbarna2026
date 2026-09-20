"use client";

import { useState } from "react";
import type { RankedSite, SiteStatus } from "@arca/core";
import type { CallView } from "@/lib/api";
import { CallState } from "./CallState";
import { ScriptPreview } from "./ScriptPreview";
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
  calls: CallView[];
  onApprove: (site: RankedSite) => void;
  onSetStatus: (site: RankedSite, status: SiteStatus) => void;
  onSelect: (assetId: string) => void;
  onTranscript: (assetId: string, transcript: string) => Promise<void>;
  busy: boolean;
  canCall: boolean;
  incidentId: string;
  /** Empty means ARCA dials nobody; the button says so rather than lying. */
  callsArmed: boolean;
}

export function NextAction(props: NextActionProps) {
  const { site } = props;
  const [showScript, setShowScript] = useState(false);

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
              {site.evac.basis === "reported"
                ? "people reported on site"
                : site.evac.basis === "registered"
                  ? "people at registered capacity"
                  : "people, estimated for this kind of site"}
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
            <>
              <span className="text-[11px] text-[var(--color-ink-faint)]">
                Marked {site.status.replace(/_/g, " ")}.
              </span>
              <button
                type="button"
                onClick={() => setShowScript(!showScript)}
                title="Hear the opening in the agent's own voice. Nobody is called."
                className="text-[11px] px-2 py-1 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
              >
                {showScript ? "Hide script" : "Hear it"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={props.busy || !props.canCall}
                onClick={() => props.onApprove(site)}
                title={
                  !props.canCall
                    ? "Voice is not configured on this deployment. Set SLNG_API_KEY and SLNG_AGENT_ID on the agent."
                    : props.callsArmed
                      ? `Records who approved it, then dials ${site.name}. The agent reads the recommendation and asks how many people are there now.`
                      : `Records who approved it. CALL_ALLOWLIST is empty, so nobody is dialled — a browser voice session opens with the identical script instead.`
                }
                className="text-[12px] px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-40"
                style={{ background: `${style.colour}22`, color: style.colour, border: `1px solid ${style.colour}66` }}
              >
                {props.busy ? "Calling…" : props.callsArmed ? "Approve call" : "Approve call"}
              </button>
              <button
                type="button"
                onClick={() => setShowScript(!showScript)}
                title="Hear the opening in the agent's own voice. Nobody is called."
                className="text-[12px] px-2.5 py-1.5 rounded border border-[var(--color-line-bright)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-3)] transition-colors"
              >
                {showScript ? "Hide script" : "Hear it"}
              </button>
              <button
                type="button"
                disabled={props.busy}
                onClick={() => props.onSetStatus(site, "evacuated")}
                title="Mark this site as already emptied. It drops out of the ranking and stops being offered, but stays on the list so you can see the work that is done."
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

        {showScript ? (
          <ScriptPreview
            incidentId={props.incidentId}
            assetId={site.assetId}
            onClose={() => setShowScript(false)}
          />
        ) : null}

        <CallState
          calls={props.calls}
          assetId={site.assetId}
          siteName={site.name}
          busy={props.busy}
          onTranscript={props.onTranscript}
        />
      </div>
    </section>
  );
}
