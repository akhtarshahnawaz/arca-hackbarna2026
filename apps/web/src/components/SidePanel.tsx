"use client";

import { useState } from "react";
import type { RankedSite, SiteStatus, TimelineEvent } from "@arca/core";
import type { CallView } from "@/lib/api";
import { NextAction } from "./NextAction";
import { RankedList } from "./RankedList";
import { EventFeed } from "./EventFeed";
import { ChatPanel } from "./ChatPanel";

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
 * scrubber that changes them lives.
 */

type Tab = "risk" | "activity" | "ask";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "risk", label: "At risk" },
  { id: "activity", label: "Activity" },
  { id: "ask", label: "Ask ARCA" },
];

export interface SidePanelProps {
  sites: RankedSite[];
  leadSite: RankedSite | null;
  calls: CallView[];
  timeline: TimelineEvent[];
  incidentName: string | null;
  selectedSiteId: string | null;
  busyId: string | null;
  canCall: boolean;
  canAsk: boolean;
  onSelect: (assetId: string | null) => void;
  onApprove: (site: RankedSite) => void;
  onDeny: (site: RankedSite) => void;
  onSetStatus: (site: RankedSite, status: SiteStatus) => void;
  onTranscript: (assetId: string, transcript: string) => Promise<void>;
}

export function SidePanel(props: SidePanelProps) {
  const [tab, setTab] = useState<Tab>("risk");
  const ranked = props.sites.filter((site) => site.rank > 0);

  return (
    <aside className="min-w-0 min-h-0 flex flex-col gap-2">
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
      />

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
              </button>
            );
          })}
          {tab === "risk" ? (
            <span className="ml-auto pr-1 text-[9.5px] text-[var(--color-ink-faint)]">
              by spare time
            </span>
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
              />
            </div>
          ) : tab === "activity" ? (
            <div className="h-full overflow-y-auto p-2 pr-1.5">
              <EventFeed events={props.timeline} />
            </div>
          ) : (
            <div className="h-full p-2">
              <ChatPanel incidentName={props.incidentName} available={props.canAsk} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
