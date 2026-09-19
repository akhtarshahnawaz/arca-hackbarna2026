"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmedCopy, freshnessLabel, formatClock, registeredCopy } from "@/lib/freshness";
import {
  actionUi,
  arcaMayCall,
  type ProtectiveAction,
} from "@/lib/protective-action";
import { siteKindLabel } from "@/lib/site-kind";
import {
  plainDuration,
  timeLeftCopy,
  urgencyBadgeLabel,
  urgencyRowCopy,
  urgencySituationCopy,
  urgencyTier,
  type UrgencyTier,
} from "@/lib/urgency";
import type { CommandState, RankedSite, VoiceCallSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const CommandMap = dynamic(() => import("@/components/command-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const tierRowClass: Record<UrgencyTier, string> = {
  late: "bg-red-50 text-red-950 hover:bg-red-100",
  now: "bg-orange-50 text-orange-950 hover:bg-orange-100",
  prepare: "bg-amber-50 text-amber-950 hover:bg-amber-100/80",
  none: "bg-background text-foreground hover:bg-muted/70",
};

const tierBadgeClass: Record<UrgencyTier, string> = {
  late: "bg-red-700 text-white",
  now: "bg-orange-700 text-white",
  prepare: "bg-amber-200 text-amber-950",
  none: "bg-muted text-foreground",
};

const tierPanelClass: Record<UrgencyTier, string> = {
  late: "bg-red-50/90 text-red-950",
  now: "bg-orange-50/90 text-orange-950",
  prepare: "bg-amber-50/80 text-amber-950",
  none: "bg-muted/40 text-foreground",
};

type Props = {
  initial: CommandState;
};

function firstUndecidedId(sites: RankedSite[]): string | null {
  return sites.find((site) => !site.protectiveAction)?.id ?? sites[0]?.id ?? null;
}

export function CommandConsole({ initial }: Props) {
  const [state, setState] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(() => firstUndecidedId(initial.sites ?? []));
  const [basemap, setBasemap] = useState<"map" | "satellite">("satellite");

  const ranked = state.sites ?? [];
  const watchSites = state.watch ?? [];
  const alerts = state.alerts ?? [];
  const banners = state.banners ?? [];
  const sources = state.sources ?? [];

  const openSite = useMemo(() => {
    if (!openId) return null;
    return ranked.find((site) => site.id === openId) ?? watchSites.find((site) => site.id === openId) ?? null;
  }, [openId, ranked, watchSites]);

  const undecided = ranked.filter((site) => !site.protectiveAction);
  const decidedCount = ranked.length - undecided.length;

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

  function openNextUndecided(afterId?: string) {
    const from = afterId ? ranked.findIndex((site) => site.id === afterId) : -1;
    const next =
      ranked.slice(from + 1).find((site) => !site.protectiveAction) ??
      ranked.find((site) => !site.protectiveAction);
    if (next) setOpenId(next.id);
  }

  function patchSite(siteKey: string, patch: Partial<RankedSite>) {
    const match = (site: RankedSite) => site.id === siteKey || site.code === siteKey;
    setState((prev) => ({
      ...prev,
      sites: (prev.sites ?? []).map((site) => (match(site) ? { ...site, ...patch } : site)),
      watch: (prev.watch ?? []).map((site) => (match(site) ? { ...site, ...patch } : site)),
    }));
  }

  function upsertCall(call: VoiceCallSummary) {
    setState((prev) => ({
      ...prev,
      voiceCalls: [call, ...(prev.voiceCalls ?? []).filter((item) => item.id !== call.id)],
    }));
  }

  const firePlace = state.fire?.municipality?.split("/")[0]?.trim() || "Bages";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-2 border-b px-5 py-3 md:px-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm text-foreground/70">ARCA · {firePlace} fire</p>
            <h1 className="font-heading text-xl leading-tight tracking-tight md:text-2xl">
              {undecided.length === 0
                ? "Every urgent place has a decision"
                : undecided.length === 1
                  ? "1 place still needs your decision"
                  : `${undecided.length} places still need your decision`}
            </h1>
            <p className="max-w-xl text-sm text-foreground/80 md:text-base">
              Red is most urgent. You choose stay or leave. ARCA does not.
            </p>
          </div>
          <DecisionProgress decided={decidedCount} total={ranked.length} />
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-foreground/70 select-none">
            Data sources and notes
          </summary>
          <div className="mt-3 flex max-h-[38dvh] flex-col gap-2 overflow-y-auto">
            <FreshnessStrip sources={sources} />
            {banners.map((banner) => (
              <p key={banner} className="text-sm text-foreground/70">
                {banner}
              </p>
            ))}
          </div>
        </details>
      </header>

      {alerts.length > 0 ? (
        <div
          role="alert"
          className="flex max-h-[24dvh] shrink-0 flex-col gap-1 overflow-y-auto border-b border-red-300 bg-red-50 px-5 py-3 md:px-7"
        >
          {alerts.map((alert) => (
            <p key={alert} className="text-sm font-medium text-red-900">
              {alert}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-1">
        <aside className="order-1 flex flex-col border-b lg:order-2 lg:h-full lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-l">
          <div className="flex flex-col gap-2 px-5 py-4">
            <p className="text-base font-medium">Places, most urgent first</p>
            <UrgencyLegend />
          </div>
          <Separator />
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <ol className="flex flex-col">
              {ranked.length === 0 ? (
                <li className="px-5 py-6 text-base text-foreground/70">
                  No places in range yet. Check the map, or open data sources.
                </li>
              ) : (
                ranked.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    open={openSite?.id === site.id}
                    onToggle={toggleSite}
                    showRank
                  >
                    <SitePanel
                      site={site}
                      calls={state.voiceCalls ?? []}
                      onPatchSite={patchSite}
                      onUpsertCall={upsertCall}
                      nextCount={undecided.filter((item) => item.id !== site.id).length}
                      onOpenNext={() => openNextUndecided(site.id)}
                    />
                  </SiteRow>
                ))
              )}
            </ol>
            <WatchList
              sites={watchSites}
              openId={openSite?.id ?? null}
              onToggle={toggleSite}
              calls={state.voiceCalls ?? []}
              onPatchSite={patchSite}
              onUpsertCall={upsertCall}
              onOpenNext={() => openNextUndecided()}
            />
          </div>
        </aside>

        <section className="relative order-2 min-h-[40dvh] lg:order-1 lg:min-h-0 lg:h-full">
          <CommandMap
            state={state}
            selectedId={openId}
            onSelect={openSiteById}
            basemap={basemap}
          />
          <div className="pointer-events-none absolute bottom-4 left-4 z-30 rounded-md border bg-background/95 px-3 py-2">
            <p className="text-sm text-foreground">Orange rings: where the fire may be in the next hours</p>
          </div>
          <div className="absolute top-4 right-4 z-30 flex overflow-hidden rounded-md border bg-background shadow-sm">
            <button
              type="button"
              aria-pressed={basemap === "map"}
              onClick={() => setBasemap("map")}
              className={cn(
                "min-h-11 px-4 text-sm font-medium",
                basemap === "map" ? "bg-foreground text-background" : "text-foreground/70 hover:text-foreground",
              )}
            >
              Map
            </button>
            <button
              type="button"
              aria-pressed={basemap === "satellite"}
              onClick={() => setBasemap("satellite")}
              className={cn(
                "min-h-11 px-4 text-sm font-medium",
                basemap === "satellite"
                  ? "bg-foreground text-background"
                  : "text-foreground/70 hover:text-foreground",
              )}
            >
              Satellite
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function WatchList({
  sites,
  openId,
  onToggle,
  calls,
  onPatchSite,
  onUpsertCall,
  onOpenNext,
}: {
  sites: RankedSite[];
  openId: string | null;
  onToggle: (id: string) => void;
  calls: VoiceCallSummary[];
  onPatchSite: (siteKey: string, patch: Partial<RankedSite>) => void;
  onUpsertCall: (call: VoiceCallSummary) => void;
  onOpenNext: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-12 w-full items-center px-5 py-4 text-left text-base text-foreground/80"
      >
        Far from the fire — {sites.length} {sites.length === 1 ? "place" : "places"}
      </button>
      {open ? (
        <div>
          <p className="px-5 pb-2 text-sm text-foreground/70">
            Fire is not expected here soon. Open only if you still want to mark a decision.
          </p>
          <ol className="flex flex-col pb-2">
            {sites.length === 0 ? (
              <li className="px-5 py-3 text-base text-foreground/70">No far places on this list.</li>
            ) : (
              sites.map((site) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  open={openId === site.id}
                  onToggle={onToggle}
                  showRank={false}
                >
                  <SitePanel
                    site={site}
                    calls={calls}
                    onPatchSite={onPatchSite}
                    onUpsertCall={onUpsertCall}
                    nextCount={0}
                    onOpenNext={onOpenNext}
                  />
                </SiteRow>
              ))
            )}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function DecisionProgress({ decided, total }: { decided: number; total: number }) {
  if (total === 0) return null;
  const percent = Math.round((decided / total) * 100);
  return (
    <div className="flex min-w-[12rem] flex-col gap-2">
      <p className="text-sm font-medium">
        {decided} of {total} decided
      </p>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={decided}
        aria-label={`${decided} of ${total} places decided`}
      >
        <div className="h-full bg-foreground" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function FreshnessStrip({ sources }: { sources: CommandState["sources"] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sources.map((source) => (
          <div key={source.id} className="flex min-w-[200px] flex-col gap-1 rounded-lg border bg-card px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{source.label}</span>
              <Badge variant={source.kind === "live" ? "default" : "outline"}>{freshnessLabel(source.kind)}</Badge>
            </div>
            <p className="text-sm leading-snug text-foreground/70">{source.detail}</p>
            <p className="text-xs text-foreground/60">
              {source.fetchedAt ? `Updated ${formatClock(source.fetchedAt)}` : "No update time"}
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
    <div className="flex flex-wrap gap-2">
      {tiers.map((tier) => (
        <span
          key={tier}
          className={cn("rounded-md px-2.5 py-1 text-sm font-semibold", tierBadgeClass[tier])}
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
  const decided = Boolean(site.protectiveAction);
  return (
    <li id={`site-item-${site.id}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`site-panel-${site.id}`}
        onClick={() => onToggle(site.id)}
        className={cn(
          "flex w-full min-w-0 max-w-full flex-col gap-2 px-4 py-4 text-left transition-colors sm:flex-row sm:items-start sm:gap-3",
          tierRowClass[tier],
          open && "ring-2 ring-foreground/60 ring-inset",
        )}
      >
        <span className="flex min-w-0 w-full flex-1 items-start gap-3">
          <span className="w-8 pt-0.5 text-center text-xl font-semibold tabular-nums">
            {showRank ? site.rank : "·"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-lg font-medium">{site.name ?? site.code}</span>
            <span className="mt-0.5 block text-sm">
              {siteKindLabel(site.kind)} · {site.municipality}
            </span>
            <span className="mt-1 block text-sm text-current/80">{site.locationQuality === "municipality_centroid" ? "Location needs verification · fire exposure unknown" : urgencyRowCopy(site)}</span>
          </span>
        </span>
        <span className="flex w-full flex-col items-start gap-1 pl-11 sm:w-auto sm:shrink-0 sm:items-end sm:pl-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md px-2.5 py-1 text-sm font-bold", tierBadgeClass[tier])}>
              {urgencyBadgeLabel[tier]}
            </span>
            <span className="text-sm font-medium">{site.locationQuality === "municipality_centroid" ? "Timing unknown" : timeLeftCopy(site)}</span>
          </span>
          <span
            className={cn(
              "text-sm font-semibold",
              decided ? "text-current" : "underline decoration-2 underline-offset-4",
            )}
          >
            {decided ? actionUi[site.protectiveAction!].title : "Needs a decision"}
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
  const capacity = site.datasetId
    ? site.facilityCapacity == null ? "Capacity unknown" : `${site.facilityCapacity} ${site.capacityUnit ?? "places"}${site.capacityPeriod ? ` (${site.capacityPeriod})` : ""} · not current occupancy`
    : null;
  const bits = [animals || null, transport, capacity].filter(Boolean);
  return bits.length ? bits.join(" · ") : null;
}

function SitePanel({
  site,
  calls,
  onPatchSite,
  onUpsertCall,
  nextCount,
  onOpenNext,
}: {
  site: RankedSite;
  calls: VoiceCallSummary[];
  onPatchSite: (siteKey: string, patch: Partial<RankedSite>) => void;
  onUpsertCall: (call: VoiceCallSummary) => void;
  nextCount: number;
  onOpenNext: () => void;
}) {
  const tier = urgencyTier(site);
  const facts = siteFactsLine(site);
  const mayCall = arcaMayCall(site.protectiveAction);

  return (
    <div id={`site-panel-${site.id}`} className={cn("flex flex-col gap-5 border-t px-4 py-4", tierPanelClass[tier])}>
      {site.locationQuality === "municipality_centroid" ? <p className="text-sm font-semibold">Approximate municipality location — verify the address. Fire-arrival estimates are unavailable for this facility.</p> : null}
      {site.sourceUrl ? <p className="text-sm"><a className="underline" href={site.sourceUrl} target="_blank" rel="noreferrer">{site.attribution} · {site.sourceRecordId}</a>{site.capacitySourceUrl ? <> · <a className="underline" href={site.capacitySourceUrl} target="_blank" rel="noreferrer">Capacity source</a></> : null}</p> : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase">What the clocks say</h2>
        <div className="grid grid-cols-2 gap-3">
          <Metric
            label="Fire may arrive"
            value={site.locationQuality === "municipality_centroid" ? "Unknown location" : site.tArrival === null ? "Not soon" : `About ${plainDuration(site.tArrival)}`}
          />
          <Metric label="Time they need to leave" value={plainDuration(site.tEvac)} />
        </div>
        <p className="text-sm leading-relaxed">{site.locationQuality === "municipality_centroid" ? "Verify the facility coordinates before using fire-arrival estimates." : urgencySituationCopy(site)}</p>
        {facts ? <p className="text-sm">{facts}</p> : null}
      </section>

      <ProtectiveChoice site={site} onPatchSite={onPatchSite} nextCount={nextCount} onOpenNext={onOpenNext} />

      {mayCall ? <CallApprove site={site} calls={calls} onUpsertCall={onUpsertCall} /> : null}

      <details className="text-sm">
        <summary className="cursor-pointer font-medium select-none">More about this place</summary>
        <div className="mt-2 flex flex-col gap-1 text-current/80">
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

function humanCallError(message: string, phoneOnFile: boolean): string {
  const text = message.toLowerCase();
  if (text.includes("must enter a number") || text.includes("no phone")) {
    return phoneOnFile
      ? "We could not use the number on file. Please type the phone number."
      : "Please type the phone number for this place. Spaces are fine.";
  }
  if (text.includes("confine") || text.includes("evacuate") || text.includes("refused")) {
    return "Choose Stay inside or Leave first. Then you can prepare a call.";
  }
  return message || "The call did not go through. Try again.";
}

function callStatusForCoordinator(call: VoiceCallSummary): string {
  if (call.status === "stubbed") return "Test mode — no real call was placed.";
  if (call.status === "awaiting_approval") return "Ready. Press Approve and dial when you want the phone to ring.";
  if (call.status === "approved" || call.status === "dialing" || call.status === "recording") {
    return "Calling now.";
  }
  if (call.status === "confirmed") return "They answered and confirmed.";
  if (call.status === "unanswered") return "No answer. We can try again later.";
  if (call.status === "busy") return "The line was busy.";
  if (call.status === "voicemail") return "Went to voicemail.";
  if (call.status === "hung_up") return "The call ended before we finished.";
  if (call.status === "unreachable") return "We could not reach them.";
  if (call.status === "denied") return "This call was cancelled.";
  return call.uiStatus ?? call.status.replaceAll("_", " ");
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
  const waiting = latest?.status === "awaiting_approval";
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneRequired = !site.phoneOnFile;
  const fieldId = `phone-${site.id}`;
  const errorId = `phone-error-${site.id}`;

  async function post(action: "request" | "approve") {
    if (action === "request" && phoneRequired && !number.trim()) {
      setError("Please type the phone number for this place. Spaces are fine.");
      return;
    }
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
        setError(humanCallError(json.error ?? "The call did not go through. Try again.", Boolean(site.phoneOnFile)));
        setBusy(false);
        return;
      }
      if (json.call) onUpsertCall(json.call);
      setBusy(false);
    } catch {
      setError("We could not reach the phone service. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-current/15 bg-background/70 p-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase">Call this place</h2>
      {latest ? <p className="text-base font-medium">{callStatusForCoordinator(latest)}</p> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Phone number
          {phoneRequired ? <span className="text-red-800"> Required</span> : <span className="font-normal"> Optional</span>}
        </label>
        <input
          id={fieldId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="min-h-12 rounded-md border bg-background px-3 text-base"
          placeholder="600 111 222"
          value={number}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : `${fieldId}-hint`}
          onChange={(event) => {
            setNumber(event.target.value);
            if (error) setError(null);
          }}
        />
        <p id={`${fieldId}-hint`} className="text-sm text-current/70">
          {site.phoneOnFile
            ? "A number is already on file. Leave this blank to use it, or type another. Spaces are fine."
            : "Type the number. Spaces and extra zeros are fine."}
        </p>
      </div>

      {error ? (
        <p id={errorId} className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-900" role="alert">
          {error}
        </p>
      ) : null}

      {waiting ? (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            className="min-h-12 w-full text-base"
            disabled={busy}
            onClick={() => post("approve")}
          >
            {busy ? "Starting the call…" : "Approve and dial"}
          </Button>
          <button
            type="button"
            className="min-h-11 text-sm underline underline-offset-4"
            disabled={busy}
            onClick={() => post("request")}
          >
            Prepare again with this number
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="min-h-12 w-full text-base"
          disabled={busy}
          onClick={() => post("request")}
        >
          {busy ? "Preparing…" : "Prepare this call"}
        </Button>
      )}
    </section>
  );
}

function decisionGroups(tier: UrgencyTier): { heading: string; actions: ProtectiveAction[] }[] {
  const stay = { heading: "No call", actions: ["monitor", "latent"] as ProtectiveAction[] };
  const contact = { heading: "We can call them", actions: ["confine", "evacuate"] as ProtectiveAction[] };
  if (tier === "late" || tier === "now") return [contact, stay];
  return [stay, contact];
}

function ProtectiveChoice({
  site,
  onPatchSite,
  nextCount,
  onOpenNext,
}: {
  site: RankedSite;
  onPatchSite: (siteKey: string, patch: Partial<RankedSite>) => void;
  nextCount: number;
  onOpenNext: () => void;
}) {
  const [busy, setBusy] = useState<ProtectiveAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<ProtectiveAction | null>(site.protectiveAction);
  const tier = urgencyTier(site);

  async function choose(action: ProtectiveAction) {
    const previous = site.protectiveAction;
    setBusy(action);
    setError(null);
    onPatchSite(site.id, { protectiveAction: action });
    setJustSaved(action);
    try {
      const response = await fetch("/api/protective-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: site.code, action }),
      });
      if (!response.ok) {
        onPatchSite(site.id, { protectiveAction: previous });
        setJustSaved(previous);
        setError("Could not save your decision for this place. Try again.");
        setBusy(null);
        return;
      }
      setBusy(null);
    } catch {
      onPatchSite(site.id, { protectiveAction: previous });
      setJustSaved(previous);
      setError("Could not save your decision for this place. Check your connection and try again.");
      setBusy(null);
    }
  }

  const saved = justSaved ?? site.protectiveAction;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Your decision</h2>
        <p className="text-sm">
          Required. Pick one. This is not an order from ARCA — it is your choice.
        </p>
      </div>

      {decisionGroups(tier).map((group) => (
        <div key={group.heading} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{group.heading}</p>
          <div className="flex flex-col gap-2">
            {group.actions.map((action) => {
              const selected = site.protectiveAction === action;
              const copy = actionUi[action];
              return (
                <button
                  key={action}
                  type="button"
                  disabled={busy !== null}
                  aria-pressed={selected}
                  onClick={() => choose(action)}
                  className={cn(
                    "flex min-h-14 flex-col items-start gap-0.5 rounded-lg border px-3 py-3 text-left transition-colors",
                    selected
                      ? "border-foreground bg-foreground text-background"
                      : "border-current/20 bg-background/80 hover:bg-background",
                  )}
                >
                  <span className="text-base font-semibold">
                    {busy === action ? "Saving…" : copy.title}
                  </span>
                  <span className={cn("text-sm", selected ? "text-background/80" : "text-current/75")}>
                    {copy.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {error ? (
        <p className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-900" role="alert">
          {error}
        </p>
      ) : null}

      {saved && !error ? (
        <div className="flex flex-col gap-2 rounded-lg bg-background/80 px-3 py-3">
          <p className="text-base font-medium">
            Saved: {actionUi[saved].title}.{" "}
            {actionUi[saved].unlocksCall
              ? "Next: prepare the call below."
              : "We will not call this place."}
          </p>
          {nextCount > 0 ? (
            <Button type="button" variant="outline" className="min-h-12 text-base" onClick={onOpenNext}>
              Open the next place ({nextCount} left)
            </Button>
          ) : (
            <p className="text-sm">No other urgent places are waiting on a decision.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-current/70">{label}</p>
      <p className="text-xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}
