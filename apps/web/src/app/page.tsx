"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RankedSite, SiteStatus } from "@arca/core";
import { api, useIncident, useIncidentList } from "@/lib/api";
import { IncidentHeader } from "@/components/IncidentHeader";
import { ImpactStrip, NextAction } from "@/components/NextAction";
import { RankedList } from "@/components/RankedList";
import { TimelineScrubber } from "@/components/TimelineScrubber";
import { EventFeed } from "@/components/EventFeed";
import { ChatPanel } from "@/components/ChatPanel";
import { Legend } from "@/components/Legend";
import { IncidentPicker } from "@/components/IncidentPicker";
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

type Tab = "timeline" | "chat";

export default function OperationsPage() {
  const { incidents, reload: reloadList } = useIncidentList();
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const { data, error, live, reload } = useIncident(incidentId);

  const [hour, setHour] = useState<number | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [showMasked, setShowMasked] = useState(true);
  const [showAssets, setShowAssets] = useState(true);
  const [tab, setTab] = useState<Tab>("timeline");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [capabilities, setCapabilities] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void api
      .health()
      .then((health) => setCapabilities(health.capabilities))
      .catch(() => setCapabilities({}));
  }, []);

  // Open the most urgent incident by default, so a wall display is useful the
  // moment it is switched on rather than after someone picks from a list.
  useEffect(() => {
    if (incidentId || incidents.length === 0) return;
    const mostUrgent =
      [...incidents].sort(
        (a, b) =>
          b.counts.shelterCandidates - a.counts.shelterCandidates ||
          b.counts.evacuateNow - a.counts.evacuateNow ||
          b.confirmation.score - a.confirmation.score,
      )[0] ?? incidents[0];
    if (mostUrgent) setIncidentId(mostUrgent.id);
  }, [incidents, incidentId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6_000);
    return () => clearTimeout(timer);
  }, [toast]);

  const frames = useMemo(() => data?.spread?.frames ?? [], [data]);
  const sites = useMemo(() => data?.sites ?? [], [data]);

  // The lead card shows the first site that still needs a decision. A site the
  // coordinator has already settled should not keep demanding attention.
  const leadSite = useMemo(
    () =>
      sites.find(
        (site) =>
          site.rank > 0 && site.status !== "evacuated" && site.status !== "do_not_call",
      ) ?? null,
    [sites],
  );

  const exposedNow = useMemo(() => {
    const within =
      hour === null
        ? sites
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

  const act = useCallback(
    async (site: RankedSite, run: () => Promise<{ message?: string }>) => {
      setBusyId(site.assetId);
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
      void act(site, () =>
        api.decide(incidentId, { kind: "approve_call", assetId: site.assetId, actor: "ops-ui" }),
      );
    },
    [incidentId, act],
  );

  const onDeny = useCallback(
    (site: RankedSite) => {
      if (!incidentId) return;
      void act(site, () =>
        api.decide(incidentId, { kind: "deny", assetId: site.assetId, actor: "ops-ui" }),
      );
    },
    [incidentId, act],
  );

  const onSetStatus = useCallback(
    (site: RankedSite, status: SiteStatus) => {
      if (!incidentId) return;
      void act(site, () =>
        api.decide(incidentId, { kind: "set_status", assetId: site.assetId, status, actor: "ops-ui" }),
      );
    },
    [incidentId, act],
  );

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

  if (!incidentId) {
    return (
      <IncidentPicker
        incidents={incidents}
        onPick={setIncidentId}
        onStarted={async (id) => {
          await reloadList();
          setIncidentId(id);
        }}
      />
    );
  }

  return (
    <main className="h-screen w-screen overflow-hidden flex flex-col gap-2 p-2 bg-[var(--color-ground)]">
      {data ? (
        <IncidentHeader
          incident={data.incident}
          spread={data.spread}
          live={live}
          exerciseMode={Boolean(capabilities.exerciseMode)}
          onRefresh={() => void onRefresh()}
          refreshing={refreshing}
        />
      ) : (
        <div className="panel px-4 py-3 text-[11px] text-[var(--color-ink-faint)]">
          {error ? `Could not load the incident: ${error}` : "Loading incident…"}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_400px] grid-rows-1 gap-2">
        {/* Map column. min-h-0 on a grid child is load-bearing: without it the
            child sizes to its content, the flex-1 map collapses to zero height,
            and MapLibre renders into nothing. */}
        <div className="min-w-0 min-h-0 flex flex-col gap-2">
          <div className="relative flex-1 min-h-0 panel overflow-hidden">
            {data ? (
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
            ) : null}

            <div className="absolute left-3 bottom-3 z-10">
              <Legend
                spread={data?.spread ?? null}
                showMasked={showMasked}
                showAssets={showAssets}
                onToggleMasked={() => setShowMasked(!showMasked)}
                onToggleAssets={() => setShowAssets(!showAssets)}
                maskedCount={maskedCount}
              />
            </div>

            <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIncidentId(null)}
                className="panel bg-[var(--color-surface)]/92 backdrop-blur px-2.5 py-1.5 text-[11px] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors"
              >
                ← All incidents
              </button>
              {data?.spread ? (
                <span className="panel bg-[var(--color-surface)]/92 backdrop-blur px-2.5 py-1.5 text-[10px] text-[var(--color-ink-dim)]">
                  <span className="text-[var(--color-ink)]">
                    {hour === null
                      ? `Where the fire may reach in ${frames.length || 6} h`
                      : `Where the fire may reach by +${hour} h`}
                  </span>
                  <span className="text-[var(--color-ink-faint)]"> · {describeSpread(data.spread, frames)}</span>
                </span>
              ) : null}
            </div>

            {data?.exposure?.warnings && data.exposure.warnings.length > 0 ? (
              <div className="absolute right-3 top-3 z-10 max-w-[300px] panel bg-[var(--color-surface)]/92 backdrop-blur px-2.5 py-2">
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
          </div>

          <TimelineScrubber
            frames={frames}
            hour={hour}
            onChange={setHour}
            disabled={frames.length === 0}
          />
        </div>

        {/* Side column */}
        <aside className="min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden">
          <NextAction
            site={leadSite}
            totalRanked={sites.filter((site) => site.rank > 0).length}
            onApprove={onApprove}
            onSetStatus={onSetStatus}
            onSelect={setSelectedSiteId}
            busy={busyId === leadSite?.assetId}
            canCall={Boolean(capabilities.slng)}
          />

          <ImpactStrip
            people={exposedNow.people}
            sites={exposedNow.sites}
            outOfTime={exposedNow.outOfTime}
            hour={hour}
            horizonHours={frames.length || 6}
          />

          <div className="flex-1 min-h-0 flex flex-col panel p-2">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
                Then these
              </h2>
              <span className="text-[10px] text-[var(--color-ink-faint)]">by spare time</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
              <RankedList
                sites={sites}
                skipRanks={leadSite ? [leadSite.rank] : []}
                selectedId={selectedSiteId}
                onSelect={setSelectedSiteId}
                onApprove={onApprove}
                onDeny={onDeny}
                onSetStatus={onSetStatus}
                busyId={busyId}
                canCall={Boolean(capabilities.slng)}
              />
            </div>
          </div>

          <div className="h-[228px] shrink-0 flex flex-col panel p-2">
            <div className="flex items-center gap-1 px-1 pb-2">
              {(["timeline", "chat"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`text-[10px] uppercase tracking-[0.1em] px-2 py-1 rounded transition-colors ${
                    tab === value
                      ? "text-[var(--color-ink)] bg-[var(--color-surface-3)]"
                      : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
                  }`}
                >
                  {value === "timeline" ? "What happened" : "Ask ARCA"}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {tab === "timeline" ? (
                <div className="h-full overflow-y-auto pr-0.5">
                  <EventFeed events={data?.timeline ?? []} />
                </div>
              ) : (
                <ChatPanel
                  incidentName={data?.incident.name ?? null}
                  available={Boolean(capabilities.nebius)}
                />
              )}
            </div>
          </div>
        </aside>
      </div>

      {toast ? (
        <div
          role="status"
          className="enter fixed bottom-4 left-1/2 -translate-x-1/2 z-50 panel bg-[var(--color-surface-2)] px-4 py-2.5 max-w-[620px] shadow-2xl"
        >
          <p className="text-[11px] text-[var(--color-ink-dim)]">{toast}</p>
        </div>
      ) : null}
    </main>
  );
}
