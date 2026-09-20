"use client";

import { useState } from "react";
import type { RankedSite, SiteStatus } from "@arca/core";
import { ACTION_STYLE, minutes, titleCase } from "@/lib/format";

/**
 * Who to call first.
 *
 * Ordered by spare time, which is the only ordering that answers the question.
 * Each row carries the arithmetic behind its position — arrival, evacuation
 * need, the difference — because a ranked list a coordinator cannot interrogate
 * is a ranked list they will not use twice.
 */

export interface RankedListProps {
  /** Ranks to hide, because another component is already showing them. */
  skipRanks?: number[];
  sites: RankedSite[];
  selectedId: string | null;
  onSelect: (assetId: string | null) => void;
  onApprove: (site: RankedSite) => void;
  onDeny: (site: RankedSite) => void;
  onSetStatus: (site: RankedSite, status: SiteStatus) => void;
  busyId: string | null;
  canCall: boolean;
}

export function RankedList(props: RankedListProps) {
  const [showWatch, setShowWatch] = useState(false);
  const skip = new Set(props.skipRanks ?? []);
  const ranked = props.sites.filter((site) => site.rank > 0 && !skip.has(site.rank));
  const watch = props.sites.filter((site) => site.rank === 0);

  if (props.sites.length === 0) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-sm text-[var(--color-ink-dim)]">Nothing ranked yet.</p>
        <p className="mt-1 text-[11px] text-[var(--color-ink-faint)]">
          A ranking appears once a model run and an exposure query have both completed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {ranked.map((site) => (
        <SiteRow
          key={site.assetId}
          site={site}
          selected={props.selectedId === site.assetId}
          busy={props.busyId === site.assetId}
          canCall={props.canCall}
          onSelect={props.onSelect}
          onApprove={props.onApprove}
          onDeny={props.onDeny}
          onSetStatus={props.onSetStatus}
        />
      ))}

      {watch.length > 0 ? (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowWatch(!showWatch)}
            className="w-full text-left px-3 py-2 text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
          >
            {showWatch ? "Hide" : "Show"} watch list ({watch.length}) — below the{" "}
            {Math.round(0.3 * 100)}% reach threshold
          </button>
          {showWatch ? (
            <div className="flex flex-col gap-2 mt-1">
              {watch.slice(0, 30).map((site) => (
                <SiteRow
                  key={site.assetId}
                  site={site}
                  selected={props.selectedId === site.assetId}
                  busy={props.busyId === site.assetId}
                  canCall={props.canCall}
                  onSelect={props.onSelect}
                  onApprove={props.onApprove}
                  onDeny={props.onDeny}
                  onSetStatus={props.onSetStatus}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SiteRow(props: {
  site: RankedSite;
  selected: boolean;
  busy: boolean;
  canCall: boolean;
  onSelect: (assetId: string | null) => void;
  onApprove: (site: RankedSite) => void;
  onDeny: (site: RankedSite) => void;
  onSetStatus: (site: RankedSite, status: SiteStatus) => void;
}) {
  const { site } = props;
  const style = ACTION_STYLE[site.action];
  const outOfTime = site.action === "SHELTER_CANDIDATE";
  const settled = site.status === "evacuated" || site.status === "do_not_call";
  const phone = site.contacts?.phone?.[0] ?? null;

  return (
    <article
      onClick={() => props.onSelect(props.selected ? null : site.assetId)}
      className={`enter panel relative overflow-hidden cursor-pointer transition-colors ${
        props.selected ? "bg-[var(--color-surface-2)]" : "hover:bg-[var(--color-surface-2)]"
      } ${outOfTime && !settled ? "urgent" : ""}`}
      style={{ borderColor: props.selected ? `${style.colour}66` : undefined }}
      aria-current={props.selected}
    >
      {/* The action colour as a spine, so the list can be read as a pattern
          from across the room before any text is legible. */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: style.colour, opacity: settled ? 0.25 : 1 }}
      />

      <div className="pl-4 pr-3 py-2.5">
        <div className="flex items-start gap-3">
          <span
            className="num shrink-0 w-6 text-center text-sm"
            style={{ color: settled ? "var(--color-ink-faint)" : style.colour }}
          >
            {site.rank || "·"}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h3
                className={`text-sm truncate ${
                  settled ? "text-[var(--color-ink-faint)] line-through" : "text-[var(--color-ink)]"
                }`}
              >
                {site.name}
              </h3>
              {site.hazardous ? (
                <span className="shrink-0 text-[9px] uppercase tracking-wider text-[var(--color-exclusion)]">
                  hazard
                </span>
              ) : null}
            </div>

            <div className="mt-0.5 text-[10px] text-[var(--color-ink-faint)] truncate">
              {titleCase(site.subcategory)} · {site.peopleEstimate} people
              {site.evac.basis === "reported" ? " reported" : " registered"}
              {site.livestockUnits ? ` · ${site.livestockUnits} animals` : ""}
            </div>

            {/* One number decides the order, so one number is shown. The
                arithmetic behind it is in the expanded detail. */}
            <div className="mt-1.5 flex items-baseline gap-1.5 text-[11px]">
              <span
                className="num text-[13px]"
                style={{
                  color:
                    site.spareMinutes === null
                      ? "var(--color-ink-faint)"
                      : site.spareMinutes < 0
                        ? "var(--color-shelter)"
                        : site.spareMinutes < 180
                          ? "var(--color-evacuate)"
                          : "var(--color-ink)",
                }}
              >
                {site.spareMinutes === null
                  ? "—"
                  : site.spareMinutes < 0
                    ? `${minutes(Math.abs(site.spareMinutes))} short`
                    : `${minutes(site.spareMinutes)} spare`}
              </span>
              <span className="ml-auto num text-[10px] text-[var(--color-ink-faint)]">
                {site.reach.runsReaching}/{site.reach.runsTotal} runs
              </span>
            </div>
          </div>
        </div>

        <div className="mt-2 pl-9 flex items-center gap-2 flex-wrap">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: `${style.colour}1f`,
              color: style.colour,
              border: `1px solid ${style.colour}44`,
            }}
            title={style.help}
          >
            {style.short}
          </span>

          {site.status !== "unnotified" ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-dim)]">
              {titleCase(site.status)}
            </span>
          ) : null}

          {props.selected ? (
            <div className="ml-auto flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {settled ? null : (
                <>
                  <button
                    type="button"
                    disabled={props.busy || !props.canCall}
                    onClick={() => props.onApprove(site)}
                    title={
                      props.canCall
                        ? phone
                          ? `Approve a call to ${phone.slice(0, 5)}…`
                          : "No number on file: this opens a browser voice session."
                        : "Voice is not configured on this deployment."
                    }
                    className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-3)] hover:bg-[var(--color-line)] transition-colors disabled:opacity-40"
                  >
                    {props.busy ? "…" : "Approve call"}
                  </button>
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onDeny(site)}
                    className="text-[11px] px-2 py-1 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
                  >
                    Deny
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={props.busy}
                onClick={() => props.onSetStatus(site, settled ? "unnotified" : "evacuated")}
                className="text-[11px] px-2 py-1 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
              >
                {settled ? "Reopen" : "Mark clear"}
              </button>
            </div>
          ) : null}
        </div>

        {props.selected ? <SiteDetail site={site} /> : null}
      </div>
    </article>
  );
}

function Metric(props: { label: string; value: string; colour?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[10px] text-[var(--color-ink-faint)]">{props.label}</span>
      <span className="num text-[12px]" style={{ color: props.colour ?? "var(--color-ink)" }}>
        {props.value}
      </span>
    </span>
  );
}

/** The reasoning, on demand. Always available, never in the way. */
function SiteDetail(props: { site: RankedSite }) {
  const { site } = props;
  return (
    <div className="mt-3 pl-9 pt-3 border-t hairline text-[11px] leading-relaxed text-[var(--color-ink-dim)] space-y-2">
      <p>{site.explanation.actionReason}</p>

      <div className="flex items-center gap-3 text-[11px]">
        <Metric label="arrival" value={minutes(site.arrivalMinutes)} />
        <span className="text-[var(--color-ink-faint)]">−</span>
        <Metric label="needs" value={minutes(site.evac.minutes)} />
        <span className="text-[var(--color-ink-faint)]">=</span>
        <Metric label="spare" value={minutes(site.spareMinutes)} />
      </div>

      <div>
        <span className="text-[var(--color-ink-faint)]">Evacuation estimate assumes </span>
        {site.evac.assumptions.join("; ")}.
      </div>

      {site.reported ? (
        <div className="rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] mb-1">
            Reported by phone
          </div>
          {site.reported.peoplePresent !== null ? (
            <div>{site.reported.peoplePresent} people present</div>
          ) : null}
          {site.reported.nonAmbulatory ? (
            <div>{site.reported.nonAmbulatory} unable to walk unaided</div>
          ) : null}
          {site.reported.vehicles.length > 0 ? (
            <div>Vehicles: {site.reported.vehicles.join(", ")}</div>
          ) : null}
          {site.reported.corrections.map((correction) => (
            <div key={correction} className="text-[var(--color-ink-faint)]">
              {correction}
            </div>
          ))}
          {site.reported.notes ? <div className="mt-1">{site.reported.notes}</div> : null}
          {site.reported.confidence < 0.5 ? (
            <div className="mt-1 text-[var(--color-warn)]">
              Low confidence: the line was unclear. Treat as unconfirmed.
            </div>
          ) : null}
        </div>
      ) : null}

      {site.occupancyNote ? (
        <p className="text-[var(--color-ink-faint)]">{site.occupancyNote}</p>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-ink-faint)]">
        {site.provenance.length > 0 ? (
          <span>Sources: {site.provenance.map((p) => p.source_id).join(", ")}</span>
        ) : null}
        {site.valuation?.total_eur ? (
          <span>
            Replacement {Math.round(site.valuation.total_eur / 1000)}k EUR ({site.valuation.method},
            triage estimate)
          </span>
        ) : null}
        {site.distanceToFrontM !== null ? (
          <span>{Math.round(site.distanceToFrontM)} m from the front</span>
        ) : null}
      </div>
    </div>
  );
}
