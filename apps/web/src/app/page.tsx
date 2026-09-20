"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClusterSummary, RankedSite, ScenarioSummary, SiteStatus } from "@arca/core";
import { api, onUnauthorised, useFeed, useIncident, useIncidentList, type Mode } from "@/lib/api";
import { TopBar } from "@/components/TopBar";
import { FeedRail } from "@/components/FeedRail";
import { SidePanel } from "@/components/SidePanel";
import { TimelineScrubber } from "@/components/TimelineScrubber";
import { Legend } from "@/components/Legend";
import { EmptyStage } from "@/components/EmptyStage";
import { AssistantDock } from "@/components/AssistantDock";
import { TokenGate } from "@/components/TokenGate";
import { describeSpread } from "@/components/IncidentMap";

// MapLibre touches window at import time, so it cannot be server-rendered.
const IncidentMap = dynamic(
  () => import("@/components/IncidentMap").then((module) => module.IncidentMap),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 grid place-items-center text-[11px] text-[var(--color-ink-faint)]">
        Loading map…
      </div>
    ),
  },
);

/**
 * The operations screen.
 *
 * Three columns, and each one answers a different question. Left: what is
 * burning. Centre: where this one is going. Right: who to call about it. The
 * mode switch at the top says which world all three are describing, and it is
 * the only control that changes where the data comes from.
 */
export default function OperationsPage() {
  const [mode, setMode] = useState<Mode>("live");
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [area, setArea] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const { incidents, reload: reloadList } = useIncidentList();
  const feed = useFeed(mode, area);
  const { data, error, live, reload } = useIncident(incidentId);

  const [hour, setHour] = useState<number | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [showMasked, setShowMasked] = useState(true);
  const [showAssets, setShowAssets] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});

  // Any 401 anywhere puts the door up, rather than leaving the operator with a
  // screen of errors and no indication that a token is involved.
  useEffect(() => {
    onUnauthorised(() => setLocked(true));
    return () => onUnauthorised(null);
  }, []);

  useEffect(() => {
    void api
      .health()
      .then((health) => {
        setCapabilities(health.capabilities);
        // A deployment with no DeepFire credentials has no live feed at all.
        // Opening on an empty list and letting the operator discover that is
        // worse than starting where there is something to work.
        if (!health.capabilities.deepfire) setMode("synthetic");
      })
      .catch(() => setCapabilities({}));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7_000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Switching modes must not leave the previous world's incident on the map.
  useEffect(() => {
    setIncidentId((current) => {
      if (!current) return current;
      const incident = incidents.find((entry) => entry.id === current);
      if (!incident) return current;
      return incident.replay === (mode === "synthetic") ? current : null;
    });
  }, [mode, incidents]);

  const frames = useMemo(() => data?.spread?.frames ?? [], [data]);
  const sites = useMemo(() => data?.sites ?? [], [data]);

  // The lead card shows the first site that still needs a decision. A site the
  // coordinator has already settled should not keep demanding attention.
  const leadSite = useMemo(
    () =>
      sites.find(
        (site) => site.rank > 0 && site.status !== "evacuated" && site.status !== "do_not_call",
      ) ?? null,
    [sites],
  );

  const impact = useMemo(() => {
    const within =
      hour === null
        ? sites.filter((site) => site.rank > 0)
        : sites.filter((site) => site.arrivalMinutes !== null && site.arrivalMinutes <= hour * 60);
    return {
      people: within.reduce((sum, site) => sum + site.peopleEstimate, 0),
      sites: within.length,
      outOfTime: within.filter((site) => site.action === "SHELTER_CANDIDATE").length,
    };
  }, [sites, hour]);

  const maskedCount = useMemo(
    () => (data?.hotspots ?? []).filter((hotspot) => hotspot.flags.includes("static_source")).length,
    [data],
  );

  const selectedCluster = useMemo(() => {
    if (!data) return null;
    return data.incident.clusterId;
  }, [data]);

  // ---------------------------------------------------------------------------
  // Picking something to work
  // ---------------------------------------------------------------------------

  const pickCluster = useCallback(
    async (cluster: ClusterSummary) => {
      if (cluster.incidentId) {
        setIncidentId(cluster.incidentId);
        return;
      }
      setOpeningId(cluster.clusterId);
      setToast(
        cluster.classification === "CONFIRMED"
          ? "Opening the incident and starting the model run. This takes a few minutes."
          : `Opening this cluster at ${cluster.score}/100, below the confirmation bar. The reason is recorded on its timeline.`,
      );
      try {
        const result = await api.adopt(cluster.clusterId);
        await reloadList();
        await feed.reload(true);
        setIncidentId(result.incidentId);
      } catch (cause) {
        setToast(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setOpeningId(null);
      }
    },
    [feed, reloadList],
  );

  const pickScenario = useCallback(
    async (scenario: ScenarioSummary) => {
      if (scenario.incidentId) {
        setIncidentId(scenario.incidentId);
        return;
      }
      setOpeningId(scenario.name);
      try {
        const result = await api.startScenario(scenario.name);
        await reloadList();
        await feed.reload();
        setIncidentId(result.incidentId);
      } catch (cause) {
        setToast(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setOpeningId(null);
      }
    },
    [feed, reloadList],
  );

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  const act = useCallback(
    async (assetId: string, run: () => Promise<{ message?: string }>) => {
      setBusyId(assetId);
      try {
        const result = await run();
        if (result.message) setToast(result.message);
        await reload();
      } catch (cause) {
        setToast(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const onApprove = useCallback(
    (site: RankedSite) => {
      if (!incidentId) return;
      void act(site.assetId, () =>
        api.decide(incidentId, { kind: "approve_call", assetId: site.assetId, actor: "ops-ui" }),
      );
    },
    [incidentId, act],
  );

  const onDeny = useCallback(
    (site: RankedSite) => {
      if (!incidentId) return;
      void act(site.assetId, () =>
        api.decide(incidentId, { kind: "deny", assetId: site.assetId, actor: "ops-ui" }),
      );
    },
    [incidentId, act],
  );

  const onSetStatus = useCallback(
    (site: RankedSite, status: SiteStatus) => {
      if (!incidentId) return;
      void act(site.assetId, () =>
        api.decide(incidentId, { kind: "set_status", assetId: site.assetId, status, actor: "ops-ui" }),
      );
    },
    [incidentId, act],
  );

  const onTranscript = useCallback(
    async (assetId: string, transcript: string) => {
      if (!incidentId) return;
      await act(assetId, async () => {
        const result = await api.transcript(incidentId, assetId, transcript);
        return {
          message: result.reranked
            ? `Applied. ${result.summary} The ranking has changed.`
            : `Applied. ${result.summary}`,
        };
      });
    },
    [incidentId, act],
  );

  const onBrief = useCallback(async () => {
    if (!incidentId) return;
    setBriefing(true);
    try {
      const result = await api.brief(incidentId);
      setToast(result.message);
      await reload();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBriefing(false);
    }
  }, [incidentId, reload]);

  const onRefresh = useCallback(async () => {
    if (!incidentId) return;
    setRefreshing(true);
    setToast("Asking DeepFire for a fresh simulation. This can take minutes.");
    try {
      await api.refresh(incidentId, true);
      await reload();
      setToast("Model re-run complete.");
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  }, [incidentId, reload]);

  // ---------------------------------------------------------------------------

  if (locked) {
    return (
      <TokenGate
        onSaved={() => {
          setLocked(false);
          // Everything on screen was fetched without a token, so start again
          // rather than leaving half of it empty.
          window.location.reload();
        }}
      />
    );
  }

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col gap-2 p-2 bg-[var(--color-ground)]">
      <TopBar
        mode={mode}
        onModeChange={setMode}
        liveAvailable={capabilities.deepfire !== false}
        incident={data?.incident ?? null}
        spread={data?.spread ?? null}
        live={live}
        exerciseMode={Boolean(capabilities.exerciseMode)}
        onRefresh={() => void onRefresh()}
        refreshing={refreshing}
        onBrief={() => void onBrief()}
        briefing={briefing}
        canBrief={Boolean(capabilities.telegram)}
      />

      <div className="flex-1 min-h-0 flex gap-2">
        <FeedRail
          mode={mode}
          clusters={feed.clusters}
          scenarios={feed.scenarios}
          loading={feed.loading}
          error={feed.error}
          feedError={feed.feedError}
          at={feed.at}
          areas={feed.areas}
          area={area}
          coverage={feed.coverage}
          onAreaChange={setArea}
          selectedIncidentId={incidentId}
          selectedClusterId={selectedCluster}
          busyId={openingId}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailCollapsed(!railCollapsed)}
          onPickCluster={(cluster) => void pickCluster(cluster)}
          onPickScenario={(scenario) => void pickScenario(scenario)}
          onRescan={() => void feed.reload(true)}
        />

        {/* Map column. min-h-0 on a flex child is load-bearing: without it the
            child sizes to its content, the flex-1 map collapses to zero height,
            and MapLibre renders into nothing. */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
          <div className="relative flex-1 min-h-0 panel overflow-hidden">
            {data ? (
              <>
                <IncidentMap
                  centre={data.incident.position}
                  hotspots={data.hotspots}
                  spread={data.spread}
                  sites={sites}
                  hour={hour}
                  selectedSiteId={selectedSiteId}
                  onSelectSite={setSelectedSiteId}
                  showMasked={showMasked}
                  showAssets={showAssets}
                />

                <div className="absolute left-3 bottom-3 z-10">
                  <Legend
                    spread={data.spread}
                    showMasked={showMasked}
                    showAssets={showAssets}
                    onToggleMasked={() => setShowMasked(!showMasked)}
                    onToggleAssets={() => setShowAssets(!showAssets)}
                    maskedCount={maskedCount}
                  />
                </div>

                {data.spread ? (
                  <div
                    className="absolute left-3 top-3 z-10 panel bg-[var(--color-surface)]/92 backdrop-blur px-2.5 py-1.5 text-[10px] text-[var(--color-ink-dim)]"
                    style={
                      data.spread.provisional
                        ? { borderColor: "color-mix(in oklab, var(--color-warn) 45%, transparent)" }
                        : undefined
                    }
                  >
                    {data.spread.provisional ? (
                      <>
                        <span className="text-[var(--color-warn)]">Provisional footprint</span>
                        <span className="text-[var(--color-ink-faint)]">
                          {" "}
                          · a ring drawn around the fire while the model runs. The list below is
                          ranked on it and will be recomputed.
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[var(--color-ink)]">
                          {hour === null
                            ? `Where the fire may reach in ${frames.length || 6} h`
                            : `Where the fire may reach by +${hour} h`}
                        </span>
                        <span className="text-[var(--color-ink-faint)]">
                          {" "}
                          · {describeSpread(data.spread, frames)}
                        </span>
                      </>
                    )}
                  </div>
                ) : null}

                <AssistantDock
                  incidentName={data.incident.name}
                  available={Boolean(capabilities.nebius)}
                />

                {data.exposure?.warnings && data.exposure.warnings.length > 0 ? (
                  <div className="absolute right-3 top-3 z-10 max-w-[310px] panel bg-[var(--color-surface)]/92 backdrop-blur px-2.5 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-warn)] mb-1">
                      Data warnings
                    </div>
                    <ul className="space-y-1">
                      {data.exposure.warnings.slice(0, 3).map((warning) => (
                        <li key={warning} className="text-[10px] text-[var(--color-ink-dim)] leading-snug">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            ) : (
              <EmptyStage
                mode={mode}
                loading={feed.loading || Boolean(incidentId && !error)}
                error={error}
                clusterCount={feed.clusters.length}
                scenarioCount={feed.scenarios.length}
                onSwitchMode={() => setMode(mode === "live" ? "synthetic" : "live")}
              />
            )}
          </div>

          <TimelineScrubber
            frames={frames}
            hour={hour}
            onChange={setHour}
            disabled={frames.length === 0}
            impact={data ? impact : null}
          />
        </div>

        <div className="w-[392px] shrink-0 min-h-0">
          {data ? (
            <SidePanel
              sites={sites}
              leadSite={leadSite}
              calls={data.calls}
              timeline={data.timeline}
              diffs={data.diffs}
              selectedSiteId={selectedSiteId}
              busyId={busyId}
              canCall={Boolean(capabilities.slng)}
              callsArmed={Boolean(capabilities.outboundCalls)}
              incidentId={data.incident.id}
              onSelect={setSelectedSiteId}
              onApprove={onApprove}
              onDeny={onDeny}
              onSetStatus={onSetStatus}
              onTranscript={onTranscript}
            />
          ) : (
            <div className="panel h-full grid place-items-center px-6">
              <p className="text-[11px] text-center leading-relaxed text-[var(--color-ink-faint)]">
                Pick a fire on the left and the ranked sites appear here, ordered by how much
                time each one has left.
              </p>
            </div>
          )}
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          className="enter fixed bottom-4 left-1/2 -translate-x-1/2 z-50 panel bg-[var(--color-surface-2)] px-4 py-2.5 max-w-[640px] shadow-2xl"
        >
          <p className="text-[11px] text-[var(--color-ink-dim)]">{toast}</p>
        </div>
      ) : null}
    </main>
  );
}
