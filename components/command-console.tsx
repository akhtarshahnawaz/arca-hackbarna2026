"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmedCopy, freshnessLabel, formatClock, registeredCopy } from "@/lib/freshness";
import {
  arcaMayCall,
  actionLabel,
  PROTECTIVE_ACTIONS,
  type ProtectiveAction,
} from "@/lib/protective-action";
import { siteKindBadgeClass, siteKindLabel } from "@/lib/site-kind";
import {
  plainDuration,
  timeLeftCopy,
  urgencyBadgeLabel,
  urgencyRowCopy,
  urgencyTier,
  type UrgencyTier,
} from "@/lib/urgency";
import { callStatusLabel } from "@/lib/call-status";
import type { CommandState, RankedSite, VoiceCallSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const CommandMap = dynamic(() => import("@/components/command-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const tierRowClass: Record<UrgencyTier, string> = {
  late: "border-l-4 border-l-red-600 bg-red-50 hover:bg-red-100/70",
  now: "border-l-4 border-l-orange-500 bg-orange-50 hover:bg-orange-100/70",
  prepare: "border-l-4 border-l-yellow-400 hover:bg-yellow-50",
  none: "border-l-4 border-l-transparent opacity-75 hover:bg-muted/60",
};

const tierBadgeClass: Record<UrgencyTier, string> = {
  late: "bg-red-600 text-white",
  now: "bg-orange-500 text-white",
  prepare: "bg-yellow-400 text-yellow-950",
  none: "bg-muted text-muted-foreground",
};

const tierPanelClass: Record<UrgencyTier, string> = {
  late: "bg-red-50/90",
  now: "bg-orange-50/90",
  prepare: "bg-yellow-50/80",
  none: "bg-muted/40",
};

type Props = {
  initial: CommandState;
};

export function CommandConsole({ initial }: Props) {
  const [state, setState] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<"map" | "satellite">("satellite");

  const watchSites = state.watch ?? [];

  const openSite = useMemo(() => {
    if (!openId) return null;
    return (
      state.sites.find((site) => site.id === openId) ??
      watchSites.find((site) => site.id === openId) ??
      null
    );
  }, [openId, state.sites, watchSites]);

  useEffect(() => {
    if (!openId) return;
    document.getElementById(`site-item-${openId}`)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [openId]);

  function toggleSite(id: string) {
    setOpenId((current) => (current === id ? null : id));
  }

  function openSiteById(id: string) {
    setOpenId(id);
  }

  function patchSite(siteKey: string, patch: Partial<RankedSite>) {
    const match = (site: RankedSite) => site.id === siteKey || site.code === siteKey;
    setState((prev) => ({
      ...prev,
      sites: prev.sites.map((site) => (match(site) ? { ...site, ...patch } : site)),
      watch: (prev.watch ?? []).map((site) => (match(site) ? { ...site, ...patch } : site)),
    }));
  }

  function upsertCall(call: VoiceCallSummary) {
    setState((prev) => ({
      ...prev,
      voiceCalls: [call, ...prev.voiceCalls.filter((item) => item.id !== call.id)],
    }));
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-3 border-b px-5 py-4 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
              Coordinator console
            </p>
            <h1 className="font-heading text-3xl tracking-tight">ARCA</h1>
            <p className="max-w-xl text-sm">
              <span className="font-medium">Red = most urgent.</span>{" "}
              <span className="text-muted-foreground">
                You choose: monitor, latent, confine, or evacuate.
              </span>
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 md:items-end">
            <Badge variant="outline">INC-DEMO Bages</Badge>
            <Badge>{state.contactPolicy?.dashboardLabel ?? "Approval required"}</Badge>
            <p className="font-mono text-xs text-muted-foreground">
              {state.fire.municipality} · {state.fire.ensembleMembers} runs · {state.fire.horizonHours} h
            </p>
          </div>
        </div>
        {/*
          `details` holds the notes only. A degraded feed never goes in here: it
          is collapsed by default, so a failure would read as one more line of
          demo copy. Capped and scrollable because at `lg` the page itself does
          not scroll, and an unbounded strip squeezes the map and the ranked
          list with no way to get them back.
        */}
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground select-none">
            Data status
          </summary>
          <div className="mt-3 flex max-h-[38dvh] flex-col gap-2 overflow-y-auto">
            <FreshnessStrip state={state} />
            {state.banners.map((banner) => (
              <p key={banner} className="text-xs text-muted-foreground">
                {banner}
              </p>
            ))}
          </div>
        </details>
      </header>

      {state.alerts.length > 0 ? (
        <div
          role="alert"
          className="flex max-h-[24dvh] shrink-0 flex-col gap-1 overflow-y-auto border-b border-destructive/40 bg-destructive/10 px-5 py-2 md:px-8"
        >
          {state.alerts.map((alert) => (
            <p key={alert} className="text-xs font-medium text-destructive">
              {alert}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-1">
        <section className="relative min-h-[52dvh] lg:min-h-0 lg:h-full">
          <CommandMap
            state={state}
            selectedId={openId}
            onSelect={openSiteById}
            basemap={basemap}
          />
          <div className="pointer-events-none absolute top-4 left-4 z-30 rounded-md border bg-background/90 px-3 py-2">
            <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Demo polygons
            </p>
            <p className="text-xs text-foreground">Hour rings from member 5 of 10</p>
          </div>
          <div className="absolute top-4 right-4 z-30 flex overflow-hidden rounded-md border bg-background shadow-sm">
            <button
              type="button"
              aria-pressed={basemap === "map"}
              onClick={() => setBasemap("map")}
              className={cn(
                "px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase",
                basemap === "map" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Map
            </button>
            <button
              type="button"
              aria-pressed={basemap === "satellite"}
              onClick={() => setBasemap("satellite")}
              className={cn(
                "px-3 py-1.5 font-mono text-[10px] tracking-[0.18em] uppercase",
                basemap === "satellite" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Satellite
            </button>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-t lg:h-full lg:overflow-hidden lg:border-t-0 lg:border-l">
          <div className="flex flex-col gap-2 px-5 py-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Most urgent first
              </p>
              <span className="font-mono text-xs text-muted-foreground">{state.sites.length}</span>
            </div>
            <UrgencyLegend />
          </div>
          <Separator />
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <ol className="flex flex-col">
              {state.sites.length === 0 ? (
                <li className="px-5 py-4 text-sm text-muted-foreground">No ranked sites.</li>
              ) : (
                state.sites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    open={openSite?.id === site.id}
                    onToggle={toggleSite}
                    showRank
                  >
                    <SitePanel
                      site={site}
                      calls={state.voiceCalls}
                      onPatchSite={patchSite}
                      onUpsertCall={upsertCall}
                    />
                  </SiteRow>
                ))
              )}
            </ol>
            <div className="border-t px-5 pt-3 pb-1">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Not close
              </p>
              <p className="text-xs text-muted-foreground">
                Fewer than {state.watchIfFewerThanRuns} of {state.fire.ensembleMembers} runs
              </p>
            </div>
            <ol className="flex flex-col pb-2">
              {watchSites.length === 0 ? (
                <li className="px-5 py-3 text-sm text-muted-foreground">No watch sites.</li>
              ) : (
                watchSites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    open={openSite?.id === site.id}
                    onToggle={toggleSite}
                    showRank={false}
                  >
                    <SitePanel
                      site={site}
                      calls={state.voiceCalls}
                      onPatchSite={patchSite}
                      onUpsertCall={upsertCall}
                    />
                  </SiteRow>
                ))
              )}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}

function FreshnessStrip({ state }: { state: CommandState }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {state.sources.map((source) => (
          <div
            key={source.id}
            className="flex min-w-[190px] flex-col gap-1 rounded-lg border bg-card px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{source.label}</span>
              <Badge variant={source.kind === "live" ? "default" : "outline"}>
                {freshnessLabel(source.kind)}
              </Badge>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">{source.detail}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {source.fetchedAt ? `Fetched ${formatClock(source.fetchedAt)}` : "No fetch time"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function UrgencyLegend() {
  const tiers: UrgencyTier[] = ["late", "now", "prepare", "none"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {tiers.map((tier) => (
        <span
          key={tier}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
            tierBadgeClass[tier],
          )}
        >
          {urgencyBadgeLabel[tier]}
        </span>
      ))}
    </div>
  );
}

function SiteRow({
  site,
  open,
  onToggle,
  showRank,
  children,
}: {
  site: RankedSite;
  open: boolean;
  onToggle: (id: string) => void;
  showRank: boolean;
  children: ReactNode;
}) {
  const tier = urgencyTier(site);
  return (
    <li id={`site-item-${site.id}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`site-panel-${site.id}`}
        onClick={() => onToggle(site.id)}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors",
          tierRowClass[tier],
          open && "ring-2 ring-foreground/50 ring-inset",
        )}
      >
        <span className="w-7 pt-0.5 text-center font-mono text-lg font-semibold">
          {showRank ? site.rank : "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{site.code}</span>
            <Badge className={siteKindBadgeClass[site.kind]}>{siteKindLabel(site.kind)}</Badge>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {site.municipality} · {urgencyRowCopy(site)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "rounded px-2 py-1 text-[11px] font-bold tracking-wide whitespace-nowrap",
              tierBadgeClass[tier],
            )}
          >
            {urgencyBadgeLabel[tier]}
          </span>
          <span
            className={cn(
              "text-[11px] font-medium whitespace-nowrap",
              tier === "late" ? "text-red-700" : "text-muted-foreground",
            )}
          >
            {timeLeftCopy(site)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {site.protectiveAction ? actionLabel[site.protectiveAction] : "No decision"}
          </span>
        </span>
      </button>
      {open ? children : null}
    </li>
  );
}

function siteFactsLine(site: RankedSite): string | null {
  const animals = site.animals
    .map((animal) => {
      const n = animal.confirmedCount ?? animal.registeredCapacity;
      return n != null ? `${n} ${animal.species}` : animal.species;
    })
    .join(", ");
  const transport =
    site.hasOwnTransport === null ? null : site.hasOwnTransport ? "own transport" : "no transport";
  const bits = [animals || null, transport].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

function SitePanel({
  site,
  calls,
  onPatchSite,
  onUpsertCall,
}: {
  site: RankedSite;
  calls: VoiceCallSummary[];
  onPatchSite: (siteKey: string, patch: Partial<RankedSite>) => void;
  onUpsertCall: (call: VoiceCallSummary) => void;
}) {
  const tier = urgencyTier(site);
  const facts = siteFactsLine(site);
  const mayCall = arcaMayCall(site.protectiveAction);

  return (
    <div
      id={`site-panel-${site.id}`}
      className={cn("flex flex-col gap-3 border-t px-4 py-3", tierPanelClass[tier])}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded px-2 py-1 text-[11px] font-bold tracking-wide",
            tierBadgeClass[tier],
          )}
        >
          {urgencyBadgeLabel[tier]}
        </span>
        <Badge className={siteKindBadgeClass[site.kind]}>{siteKindLabel(site.kind)}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Fire arrives"
          value={site.tArrival === null ? "not soon" : `~${plainDuration(site.tArrival)}`}
        />
        <Metric label="They need" value={plainDuration(site.tEvac)} />
      </div>

      {facts ? <p className="text-xs text-muted-foreground">{facts}</p> : null}

      <ProtectiveChoice site={site} onPatchSite={onPatchSite} />

      {mayCall ? (
        <CallApprove site={site} calls={calls} onUpsertCall={onUpsertCall} />
      ) : null}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">More</summary>
        <div className="mt-2 flex flex-col gap-1">
          {site.animals.map((animal) => (
            <p key={animal.species}>
              {animal.species}: {animal.confirmedCount ?? "—"} / {animal.registeredCapacity ?? "—"}
              {site.confirmedAt
                ? ` · ${confirmedCopy(site.confirmedAt, site.confirmationStatus, site.confirmationChannel)}`
                : site.capacityUpdatedAt
                  ? ` · ${registeredCopy(site.capacityUpdatedAt)}`
                  : ""}
            </p>
          ))}
          {site.shelterHint ? <p>{site.shelterHint}</p> : null}
        </div>
      </details>
    </div>
  );
}

function CallApprove({
  site,
  calls,
  onUpsertCall,
}: {
  site: RankedSite;
  calls: VoiceCallSummary[];
  onUpsertCall: (call: VoiceCallSummary) => void;
}) {
  const latest = calls.find((call) => call.siteId === site.code || call.siteId === site.id);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(action: "request" | "approve") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/voice/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          siteId: site.code,
          toNumber: number,
          callId: latest?.id,
          spareTime: site.spareTime,
        }),
      });
      const json = (await response.json()) as {
        ok?: boolean;
        error?: string;
        call?: VoiceCallSummary;
      };
      if (!response.ok || !json.ok) {
        setError(json.error ?? "Call failed.");
        setBusy(false);
        return;
      }
      if (json.call) onUpsertCall(json.call);
      setBusy(false);
    } catch {
      setError("Call failed.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {latest ? (
        <p className="text-xs">
          {latest.status === "stubbed"
            ? callStatusLabel(latest.status)
            : (latest.uiStatus ?? callStatusLabel(latest.status))}
        </p>
      ) : null}
      <input
        className="rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="E.164 number"
        value={number}
        onChange={(event) => setNumber(event.target.value)}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() => post("request")}
        >
          Call
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={busy || !latest || latest.status !== "awaiting_approval"}
          onClick={() => post("approve")}
        >
          Approve
        </Button>
      </div>
    </div>
  );
}

function ProtectiveChoice({
  site,
  onPatchSite,
}: {
  site: RankedSite;
  onPatchSite: (siteKey: string, patch: Partial<RankedSite>) => void;
}) {
  const [busy, setBusy] = useState<ProtectiveAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(action: ProtectiveAction) {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch("/api/protective-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: site.code, action }),
      });
      if (!response.ok) {
        setError("Could not save.");
        setBusy(null);
        return;
      }
      onPatchSite(site.id, { protectiveAction: action });
      setBusy(null);
    } catch {
      setError("Could not save.");
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {PROTECTIVE_ACTIONS.map((action) => {
          const selected = site.protectiveAction === action;
          return (
            <Button
              key={action}
              type="button"
              size="sm"
              variant={selected ? "default" : "outline"}
              disabled={busy !== null}
              onClick={() => choose(action)}
            >
              {busy === action ? "…" : actionLabel[action]}
            </Button>
          );
        })}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">{label}</p>
      <p className="font-mono text-lg tracking-tight">{value}</p>
    </div>
  );
}
