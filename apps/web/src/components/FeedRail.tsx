"use client";

import { useMemo, useState } from "react";
import type { ClusterSummary, ScenarioSummary } from "@arca/core";
import type { Mode } from "@/lib/api";
import { compact, timeOfDay } from "@/lib/format";

/**
 * The feed.
 *
 * Everything else on the screen is about one fire. This is the list of all of
 * them, and it is the first thing a coordinator looks at: what is burning, and
 * which one should I be working?
 *
 * It shows every active cluster, including the ones ARCA scored as noise. That
 * is deliberate. A system that silently discards nine tenths of its input gives
 * an operator no way to judge whether it is discarding the right things, and
 * the first time it is wrong they will have no reason to trust it again. So the
 * rejects are here, greyed, with the score that rejected them, and any of them
 * can be worked anyway with one click.
 */

export interface FeedRailProps {
  mode: Mode;
  clusters: ClusterSummary[];
  scenarios: ScenarioSummary[];
  loading: boolean;
  error: string | null;
  /** A survey that failed upstream; the list below it is the last good one. */
  feedError: string | null;
  at: string | null;
  selectedIncidentId: string | null;
  selectedClusterId: string | null;
  busyId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onPickCluster: (cluster: ClusterSummary) => void;
  onPickScenario: (scenario: ScenarioSummary) => void;
  onRescan: () => void;
}

export function FeedRail(props: FeedRailProps) {
  const [showRejected, setShowRejected] = useState(false);

  const { working, rejected } = useMemo(() => {
    const sorted = [...props.clusters].sort(
      (a, b) =>
        Number(Boolean(b.incidentId)) - Number(Boolean(a.incidentId)) ||
        b.score - a.score ||
        Date.parse(b.lastObserved) - Date.parse(a.lastObserved),
    );
    return {
      working: sorted.filter((cluster) => cluster.classification !== "NOISE" || cluster.incidentId),
      rejected: sorted.filter((cluster) => cluster.classification === "NOISE" && !cluster.incidentId),
    };
  }, [props.clusters]);

  const total = props.mode === "live" ? props.clusters.length : props.scenarios.length;

  if (props.collapsed) {
    return (
      <div className="panel w-11 shrink-0 flex flex-col items-center py-3 gap-3">
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label="Show the feed"
          className="w-7 h-7 grid place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ChevronIcon direction="right" />
        </button>
        <div
          className="num text-[13px] text-[var(--color-ink)]"
          title={`${total} ${props.mode === "live" ? "active clusters" : "scenarios"}`}
        >
          {total}
        </div>
        <div
          className="text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]"
          style={{ writingMode: "vertical-rl" }}
        >
          {props.mode === "live" ? "Active fires" : "Scenarios"}
        </div>
      </div>
    );
  }

  return (
    <aside className="panel w-[272px] shrink-0 min-h-0 flex flex-col">
      <header className="px-3 py-2.5 border-b hairline flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            {props.mode === "live" ? "Active fires" : "Scenarios"}
          </h2>
          <p className="mt-0.5 text-[10px] text-[var(--color-ink-faint)] truncate">
            {props.loading
              ? "Reading the feed…"
              : props.mode === "live"
                ? `${total} cluster${total === 1 ? "" : "s"}${props.at ? ` · ${timeOfDay(props.at)}Z` : ""}`
                : `${total} synthetic`}
          </p>
        </div>
        {props.mode === "live" ? (
          <button
            type="button"
            onClick={props.onRescan}
            title="Re-query DeepFire now, bypassing the cache"
            className="shrink-0 w-7 h-7 grid place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <RefreshIcon spinning={props.loading} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label="Hide the feed"
          className="shrink-0 w-7 h-7 grid place-items-center rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <ChevronIcon direction="left" />
        </button>
      </header>

      {props.error || props.feedError ? (
        <p className="px-3 py-2 text-[10px] leading-relaxed text-[var(--color-warn)] border-b hairline">
          {props.error ?? props.feedError}
          {props.feedError && props.clusters.length > 0
            ? " Showing the last feed that answered."
            : null}
        </p>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1.5">
        {props.mode === "live" ? (
          <>
            {working.length === 0 && !props.loading ? (
              <EmptyFeed rejected={rejected.length} onShowRejected={() => setShowRejected(true)} />
            ) : (
              working.map((cluster) => (
                <ClusterCard
                  key={cluster.clusterId}
                  cluster={cluster}
                  selected={
                    cluster.clusterId === props.selectedClusterId ||
                    (cluster.incidentId !== null && cluster.incidentId === props.selectedIncidentId)
                  }
                  busy={props.busyId === cluster.clusterId}
                  onPick={props.onPickCluster}
                />
              ))
            )}

            {rejected.length > 0 ? (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => setShowRejected(!showRejected)}
                  className="w-full text-left px-2 py-1.5 text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
                  title="Clusters ARCA scored below the noise threshold — flares, kilns, single uncorroborated pixels"
                >
                  {showRejected ? "Hide" : "Show"} {rejected.length} scored as noise
                </button>
                {showRejected ? (
                  <div className="flex flex-col gap-1.5 mt-1">
                    {rejected.map((cluster) => (
                      <ClusterCard
                        key={cluster.clusterId}
                        cluster={cluster}
                        selected={cluster.clusterId === props.selectedClusterId}
                        busy={props.busyId === cluster.clusterId}
                        onPick={props.onPickCluster}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          props.scenarios.map((scenario) => (
            <ScenarioCard
              key={scenario.name}
              scenario={scenario}
              selected={scenario.incidentId !== null && scenario.incidentId === props.selectedIncidentId}
              busy={props.busyId === scenario.name}
              onPick={props.onPickScenario}
            />
          ))
        )}
      </div>

      <footer className="px-3 py-2 border-t hairline text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {props.mode === "live"
          ? "Every active cluster DeepFire reports inside the area of interest, scored by ARCA. Working one runs the full pipeline on it."
          : "Generated scenarios, run through the identical pipeline. Never live data."}
      </footer>
    </aside>
  );
}

/**
 * Two genuinely different states, which an earlier version conflated.
 *
 * "DeepFire reported nothing" and "DeepFire reported nine things and ARCA
 * rejected all nine" look identical on an empty list and mean opposite things
 * about whether the system is working.
 */
function EmptyFeed(props: { rejected: number; onShowRejected: () => void }) {
  if (props.rejected > 0) {
    return (
      <div className="px-2 py-4">
        <p className="text-[12px] text-[var(--color-ink-dim)]">Nothing has cleared the bar.</p>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
          {props.rejected} cluster{props.rejected === 1 ? " is" : "s are"} active in the area of
          interest, and ARCA scored {props.rejected === 1 ? "it" : "every one of them"} as noise —
          flares, kilns, and single pixels with nothing to corroborate them.
        </p>
        <button
          type="button"
          onClick={props.onShowRejected}
          className="mt-2 text-[10px] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] underline decoration-[var(--color-line-bright)] underline-offset-2"
        >
          Show them anyway
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 py-4">
      <p className="text-[12px] text-[var(--color-ink-dim)]">Nothing is burning.</p>
      <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
        DeepFire reports no active cluster in the area of interest. That is the expected state most
        of the time. Switch to Synthetic to work a scenario.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClusterCard(props: {
  cluster: ClusterSummary;
  selected: boolean;
  busy: boolean;
  onPick: (cluster: ClusterSummary) => void;
}) {
  const { cluster } = props;
  const noise = cluster.classification === "NOISE";
  const tone =
    cluster.classification === "CONFIRMED"
      ? "var(--color-evacuate)"
      : cluster.classification === "CANDIDATE"
        ? "var(--color-warn)"
        : "var(--color-monitor)";

  return (
    <button
      type="button"
      onClick={() => props.onPick(cluster)}
      disabled={props.busy}
      aria-current={props.selected}
      aria-label={`${cluster.place ?? "Unnamed cluster"}, scored ${cluster.score} of 100, ${cluster.classification.toLowerCase()}, ${cluster.detections} usable detection${cluster.detections === 1 ? "" : "s"}`}
      className={`group relative w-full text-left rounded-lg border px-2.5 py-2 transition-colors disabled:opacity-60 ${
        props.selected
          ? "bg-[var(--color-surface-2)] border-[var(--color-line-bright)]"
          : "bg-transparent border-transparent hover:bg-[var(--color-surface-2)] hover:border-[var(--color-line)]"
      }`}
    >
      <span
        className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full"
        style={{ background: tone, opacity: noise ? 0.4 : 1 }}
      />

      <div className="pl-2">
        <div className="flex items-baseline gap-2">
          <span
            className={`text-[12.5px] truncate ${noise ? "text-[var(--color-ink-faint)]" : "text-[var(--color-ink)]"}`}
          >
            {cluster.place ?? "Unnamed cluster"}
          </span>
          <span className="num ml-auto shrink-0 text-[11px]" style={{ color: tone }}>
            {cluster.score}
          </span>
        </div>

        {/* Enough to choose between two fires without opening either: how many
            detections, from how many independent satellites, and how recent. */}
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--color-ink-faint)]">
          <span className="num">{cluster.detections}</span>
          <span>of {cluster.rawDetections} det</span>
          <span aria-hidden="true">·</span>
          <span className="num">{cluster.sources.length}</span>
          <span>sat</span>
          {cluster.maxFrpMw ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="num">{compact(cluster.maxFrpMw)}</span>
              <span>MW</span>
            </>
          ) : null}
          <span className="ml-auto num">{timeOfDay(cluster.lastObserved)}Z</span>
        </div>

        {/* A bare "0 detections" invites the conclusion that the system is
            broken. The reason it kept none is the useful half. */}
        {cluster.detections === 0 && cluster.dropped.length > 0 ? (
          <div className="mt-1 text-[9.5px] leading-snug text-[var(--color-ink-faint)]">
            All {cluster.rawDetections} dropped: {cluster.dropped[0]!.reason}
            {cluster.dropped.length > 1 ? ` (+${cluster.dropped.length - 1} other)` : ""}.
          </div>
        ) : null}

        <div className="mt-1.5 flex items-center gap-1 flex-wrap">
          {cluster.incidentId ? (
            <Tag colour="var(--color-ok)">working</Tag>
          ) : (
            <Tag colour={tone}>{cluster.classification.toLowerCase()}</Tag>
          )}
          {cluster.hasPerimeter ? <Tag>perimeter</Tag> : null}
          {cluster.spanM >= 1_000 ? <Tag>{(cluster.spanM / 1_000).toFixed(1)} km across</Tag> : null}
          {cluster.maskedDetections > 0 ? (
            <Tag help="Detections dropped as known persistent heat sources">
              {cluster.maskedDetections} masked
            </Tag>
          ) : null}
          {props.busy ? <Tag colour="var(--color-warn)">opening…</Tag> : null}
        </div>
      </div>
    </button>
  );
}

function ScenarioCard(props: {
  scenario: ScenarioSummary;
  selected: boolean;
  busy: boolean;
  onPick: (scenario: ScenarioSummary) => void;
}) {
  const { scenario } = props;
  return (
    <button
      type="button"
      onClick={() => props.onPick(scenario)}
      disabled={props.busy}
      aria-current={props.selected}
      aria-label={`${scenario.label}, synthetic scenario in ${scenario.place}`}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-60 ${
        props.selected
          ? "bg-[var(--color-surface-2)] border-[var(--color-line-bright)]"
          : "bg-transparent border-transparent hover:bg-[var(--color-surface-2)] hover:border-[var(--color-line)]"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-[var(--color-ink)] truncate">{scenario.label}</span>
        {scenario.incidentId ? (
          <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-[var(--color-ok)]">
            open
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-[10px] text-[var(--color-ink-faint)]">{scenario.place}</div>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--color-ink-dim)]">
        {scenario.blurb}
      </p>
      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        <Tag>{scenario.detections} detections</Tag>
        {scenario.assets !== null ? <Tag>{scenario.assets} sites</Tag> : null}
        {scenario.peopleEstimate !== null ? (
          <Tag>{compact(scenario.peopleEstimate)} people</Tag>
        ) : null}
        {props.busy ? <Tag colour="var(--color-warn)">running…</Tag> : null}
      </div>
    </button>
  );
}

function Tag(props: { children: React.ReactNode; colour?: string; help?: string }) {
  return (
    <span
      title={props.help}
      className="text-[9px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded"
      style={{
        color: props.colour ?? "var(--color-ink-faint)",
        background: props.colour ? `${props.colour}14` : "var(--color-surface-3)",
        border: `1px solid ${props.colour ? `${props.colour}33` : "transparent"}`,
      }}
    >
      {props.children}
    </span>
  );
}

function ChevronIcon(props: { direction: "left" | "right" }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d={props.direction === "left" ? "M7.5 2.5 4 6l3.5 3.5" : "M4.5 2.5 8 6l-3.5 3.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon(props: { spinning: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      style={props.spinning ? { animation: "spin 1s linear infinite" } : undefined}
    >
      <path
        d="M10 6a4 4 0 1 1-1.2-2.85M10 1.4V4H7.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
