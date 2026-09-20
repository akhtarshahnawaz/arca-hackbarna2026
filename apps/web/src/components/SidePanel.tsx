"use client";

import { useEffect, useState } from "react";
import type { RankedSite, RankingDiff, SiteStatus, TimelineEvent } from "@arca/core";
import type { CallView } from "@/lib/api";
import { NextAction } from "./NextAction";
import { RankedList } from "./RankedList";
import { EventFeed } from "./EventFeed";
import { SiteHistory } from "./SiteHistory";

/**
 * The side panel.
 *
 * An earlier version stacked four boxes down this column — lead card, impact
 * figures, ranked list, and a fixed-height tab box for the timeline and the
 * assistant. Four sets of borders, four headings, two independent scrollbars
 * and a permanently visible log of things that had already happened. It was
 * legible in the sense that every pixel was readable, and unusable in the sense
 * that nothing told you where to look.
 *
 * Now: one decision pinned to the top, and one body that answers exactly one
 * question at a time. The impact figures moved under the map, where the
 * scrubber that changes them lives, and the assistant moved out to a button of
 * its own — buried as a third tab, nobody found it.
 */

type Tab = "risk" | "activity";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "risk", label: "At risk" },
  { id: "activity", label: "Activity" },
];

export interface SidePanelProps {
  sites: RankedSite[];
  leadSite: RankedSite | null;
  calls: CallView[];
  timeline: TimelineEvent[];
  diffs: Array<RankingDiff & { at: string }>;
  selectedSiteId: string | null;
  busyId: string | null;
  canCall: boolean;
  callsArmed: boolean;
  incidentId: string;
  onSelect: (assetId: string | null) => void;
  onApprove: (site: RankedSite) => void;
  onDeny: (site: RankedSite) => void;
  onSetStatus: (site: RankedSite, status: SiteStatus) => void;
  onTranscript: (assetId: string, transcript: string) => Promise<void>;
}

export function SidePanel(props: SidePanelProps) {
  const [tab, setTab] = useState<Tab>("risk");
  const [scopeToSite, setScopeToSite] = useState(true);
  const ranked = props.sites.filter((site) => site.rank > 0);

  // With a site selected, Activity narrows to that site: its calls, what it
  // told us, how its position moved, and every timeline line naming it. That
  // is the question you have just before picking up a phone — "what have we
  // already said to these people" — and it used to need four places to answer.
  const selected = props.selectedSiteId
    ? (props.sites.find((site) => site.assetId === props.selectedSiteId) ?? null)
    : null;
  const showSiteHistory = tab === "activity" && selected !== null && scopeToSite;

  // Picking a different site re-scopes. Having widened to the whole incident
  // once and then had every later selection silently ignored is the kind of
  // stickiness that makes a control feel broken.
  useEffect(() => {
    if (props.selectedSiteId) setScopeToSite(true);
  }, [props.selectedSiteId]);

  return (
    <aside className="h-full min-w-0 min-h-0 flex flex-col gap-2">
      {/* shrink-0 is load-bearing: without it a lead card carrying a call
          record and a transcript box grows until the ranked list below has no
          room left to scroll in. */}
      <div className="shrink-0 max-h-[48%] overflow-y-auto">
      <NextAction
        site={props.leadSite}
        totalRanked={ranked.length}
        calls={props.calls}
        onApprove={props.onApprove}
        onSetStatus={props.onSetStatus}
        onSelect={props.onSelect}
        onTranscript={props.onTranscript}
        busy={props.busyId === props.leadSite?.assetId}
        canCall={props.canCall}
        callsArmed={props.callsArmed}
        incidentId={props.incidentId}
      />
      </div>

      <div className="flex-1 min-h-0 flex flex-col panel overflow-hidden">
        <div className="flex items-center gap-0.5 px-2 pt-2 pb-1.5 border-b hairline">
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={active}
                className={`relative px-2.5 py-1 rounded text-[11px] transition-colors ${
                  active
                    ? "text-[var(--color-ink)] bg-[var(--color-surface-3)]"
                    : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
                }`}
              >
                {entry.label}
                {entry.id === "risk" && ranked.length > 0 ? (
                  <span className="num ml-1.5 text-[10px] text-[var(--color-ink-faint)]">
                    {ranked.length}
                  </span>
                ) : null}
                {entry.id === "activity" && selected ? (
                  <span
                    className="ml-1.5 w-1.5 h-1.5 rounded-full inline-block align-middle"
                    style={{ background: "var(--color-resource)" }}
                    title={`Scoped to ${selected.name}`}
                  />
                ) : null}
              </button>
            );
          })}
          {tab === "risk" ? (
            <span className="ml-auto pr-1 text-[9.5px] text-[var(--color-ink-faint)]">
              by spare time
            </span>
          ) : null}
          {tab === "activity" && selected ? (
            <button
              type="button"
              onClick={() => setScopeToSite(!scopeToSite)}
              className="ml-auto pr-1 text-[9.5px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
            >
              {scopeToSite ? "this site" : "whole incident"}
            </button>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === "risk" ? (
            <div className="h-full overflow-y-auto p-2 pr-1.5">
              <RankedList
                sites={props.sites}
                calls={props.calls}
                skipRanks={props.leadSite ? [props.leadSite.rank] : []}
                selectedId={props.selectedSiteId}
                onSelect={props.onSelect}
                onApprove={props.onApprove}
                onDeny={props.onDeny}
                onSetStatus={props.onSetStatus}
                onTranscript={props.onTranscript}
                busyId={props.busyId}
                canCall={props.canCall}
                callsArmed={props.callsArmed}
                incidentId={props.incidentId}
              />
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-2 pr-1.5">
              {showSiteHistory && selected ? (
                <SiteHistory
                  site={selected}
                  calls={props.calls}
                  timeline={props.timeline}
                  diffs={props.diffs}
                  onShowAll={() => setScopeToSite(false)}
                />
              ) : (
                <EventFeed events={props.timeline} />
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
