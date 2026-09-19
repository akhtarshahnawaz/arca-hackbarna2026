"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmedCopy, freshnessLabel, formatClock, registeredCopy } from "@/lib/freshness";
import {
  actionUi,
  arcaMayCall,
  type ProtectiveAction,
} from "@/lib/protective-action";
import { siteKindLabel } from "@/lib/site-kind";
import {
  focusClockCopy,
  timeLeftCopy,
  urgencyTier,
  type UrgencyTier,
} from "@/lib/urgency";
import type { CommandState, RankedSite, VoiceCallSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const CommandMap = dynamic(() => import("@/components/command-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

const PRIMARY_ACTIONS: ProtectiveAction[] = ["confine", "evacuate"];
const SECONDARY_ACTIONS: ProtectiveAction[] = ["monitor", "latent"];

const tierRowClass: Record<UrgencyTier, string> = {
  late: "hover:bg-red-50",
  now: "hover:bg-orange-50",
  prepare: "hover:bg-green-50",
  none: "hover:bg-muted/60",
};

const tierDotClass: Record<UrgencyTier, string> = {
  late: "bg-red-600",
  now: "bg-orange-500",
  prepare: "bg-green-700",
  none: "bg-stone-300",
};

const tierClockClass: Record<UrgencyTier, string> = {
  late: "font-medium text-red-700",
  now: "font-medium text-orange-700",
  prepare: "font-medium text-green-800",
  none: "text-foreground/55",
};

type Props = {
  initial: CommandState;
};

export function CommandConsole({ initial }: Props) {
  const [state, setState] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
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
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openId) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [openId]);

  function openSiteById(id: string) {
    setOpenId(id);
  }

  function openNextUndecided(afterId?: string) {
    const from = afterId ? ranked.findIndex((site) => site.id === afterId) : -1;
    const next =
      ranked.slice(from + 1).find((site) => !site.protectiveAction) ??
      ranked.find((site) => !site.protectiveAction);
    if (next) setOpenId(next.id);
    else dialogRef.current?.close();
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
      <header className="flex shrink-0 flex-col gap-1.5 border-b px-5 py-3 md:px-7">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="min-w-0 text-base font-medium leading-snug">
            {undecided.length === 0
              ? "Every urgent place has a decision"
              : undecided.length === 1
                ? "1 place still needs your decision"
                : `${undecided.length} places still need your decision`}
          </h1>
          {ranked.length > 0 ? (
            <span className="text-sm text-foreground/55 tabular-nums">
              ARCA · {decidedCount} of {ranked.length} · {firePlace}
            </span>
          ) : (
            <span className="text-sm text-foreground/55">{firePlace}</span>
          )}
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-foreground/55 select-none">
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
        <aside className="order-1 flex min-w-0 flex-col border-b lg:order-2 lg:h-full lg:min-h-0 lg:overflow-hidden lg:border-b-0 lg:border-l">
          <p className="px-5 py-3 text-sm text-foreground/55">Tap a place. Most urgent first.</p>
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <ol className="flex flex-col">
              {ranked.length === 0 ? (
                <li className="px-5 py-6 text-sm text-foreground/55">
                  No places in range yet. Check the map, or open data sources.
                </li>
              ) : (
                ranked.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    active={openSite?.id === site.id}
                    onSelect={openSiteById}
                    showRank
                  />
                ))
              )}
            </ol>
            <WatchList
              sites={watchSites}
              activeId={openSite?.id ?? null}
              onSelect={openSiteById}
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
          <p className="pointer-events-none absolute bottom-3 left-4 z-30 max-w-[18rem] text-sm leading-snug text-foreground/50">
            Orange rings: possible fire in the next hours
          </p>
          <div className="absolute top-3 right-4 z-30 flex gap-2.5">
            <button
              type="button"
              aria-pressed={basemap === "map"}
              onClick={() => setBasemap("map")}
              className={cn(
                "text-sm",
                basemap === "map" ? "text-foreground underline underline-offset-4" : "text-foreground/50 hover:text-foreground/80",
              )}
            >
              Map
            </button>
            <button
              type="button"
              aria-pressed={basemap === "satellite"}
              onClick={() => setBasemap("satellite")}
              className={cn(
                "text-sm",
                basemap === "satellite"
                  ? "text-foreground underline underline-offset-4"
                  : "text-foreground/50 hover:text-foreground/80",
              )}
            >
              Satellite
            </button>
          </div>
        </section>
      </div>

      <dialog
        ref={dialogRef}
        className="arca-dialog"
        onClose={() => setOpenId(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        {openSite ? (
          <FocusCard
            key={openSite.id}
            site={openSite}
            rankedCount={ranked.length}
            calls={state.voiceCalls ?? []}
            onPatchSite={patchSite}
            onUpsertCall={upsertCall}
            nextCount={undecided.filter((item) => item.id !== openSite.id).length}
            onOpenNext={() => openNextUndecided(openSite.id)}
            onClose={() => dialogRef.current?.close()}
          />
        ) : null}
      </dialog>
    </div>
  );
}

function WatchList({
  sites,
  activeId,
  onSelect,
}: {
  sites: RankedSite[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center px-5 py-3 text-left text-sm text-foreground/55"
      >
        Far from the fire — {sites.length} {sites.length === 1 ? "place" : "places"}
      </button>
      {open ? (
        <div>
          <p className="px-5 pb-2 text-sm text-foreground/45">
            Fire is not expected here soon. Open only if you still want to mark a decision.
          </p>
          <ol className="flex flex-col pb-2">
            {sites.length === 0 ? (
              <li className="px-5 py-3 text-sm text-foreground/55">No far places on this list.</li>
            ) : (
              sites.map((site) => (
                <SiteRow
                  key={site.id}
                  site={site}
                  active={activeId === site.id}
                  onSelect={onSelect}
                  showRank={false}
                />
              ))
            )}
          </ol>
        </div>
      ) : null}
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
            <p className="text-sm text-foreground/60">
              {source.fetchedAt ? `Updated ${formatClock(source.fetchedAt)}` : "No update time"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SiteRow({
  site,
  active,
  onSelect,
  showRank,
}: {
  site: RankedSite;
  active: boolean;
  onSelect: (id: string) => void;
  showRank: boolean;
}) {
  const tier = urgencyTier(site);
  const decided = Boolean(site.protectiveAction);
  const clock =
    site.locationQuality === "municipality_centroid" ? "Timing unknown" : timeLeftCopy(site);

  return (
    <li id={`site-item-${site.id}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => onSelect(site.id)}
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted",
          tierRowClass[tier],
          decided && "opacity-55",
          active && "bg-muted",
        )}
      >
        <span className={cn("size-2 shrink-0 rounded-full", tierDotClass[tier])} aria-hidden />
        <span className="w-6 shrink-0 text-center text-sm tabular-nums text-foreground/45">
          {showRank ? site.rank : "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{site.name ?? site.code}</span>
          <span className="mt-0.5 block truncate text-sm text-foreground/50">
            {siteKindLabel(site.kind)} · {site.municipality}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span
            className={cn("text-sm tabular-nums", decided ? "text-foreground/55" : tierClockClass[tier])}
          >
            {clock}
          </span>
          {decided && site.protectiveAction ? (
            <span className="text-sm text-foreground/70">
              {actionUi[site.protectiveAction].title} ✓
            </span>
          ) : null}
        </span>
      </button>
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

function focusPlaceMeta(site: RankedSite, rankedCount: number): string {
  const kindTown = `${siteKindLabel(site.kind)} · ${site.municipality}`;
  if (site.label === "watch" || site.rank === 0) {
    return `Far from the fire · ${kindTown}`;
  }
  return `Place ${site.rank} of ${rankedCount} · ${kindTown}`;
}

function FocusCard({
  site,
  rankedCount,
  calls,
  onPatchSite,
  onUpsertCall,
  nextCount,
  onOpenNext,
  onClose,
}: {
  site: RankedSite;
  rankedCount: number;
  calls: VoiceCallSummary[];
  onPatchSite: (siteKey: string, patch: Partial<RankedSite>) => void;
  onUpsertCall: (call: VoiceCallSummary) => void;
  nextCount: number;
  onOpenNext: () => void;
  onClose: () => void;
}) {
  const facts = siteFactsLine(site);
  const mayCall = arcaMayCall(site.protectiveAction);

  return (
    <div className="flex max-h-[min(32rem,calc(100dvh-2rem))] flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <p className="text-sm text-foreground/55">{focusPlaceMeta(site, rankedCount)}</p>
        <button type="button" className="h-8 shrink-0 px-2 text-sm text-foreground/70" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
        <p className={cn("text-base leading-snug", tierClockClass[urgencyTier(site)])}>
          {(site.name ?? site.code).trim()}. {focusClockCopy(site)}
        </p>

        <ProtectiveChoice site={site} onPatchSite={onPatchSite} nextCount={nextCount} onOpenNext={onOpenNext} />

        {mayCall ? <CallApprove site={site} calls={calls} onUpsertCall={onUpsertCall} /> : null}

        {facts ? <p className="text-sm text-foreground/50">{facts}</p> : null}

        <details className="text-sm text-foreground/55">
          <summary className="cursor-pointer select-none">More about this place</summary>
          <div className="mt-2 flex flex-col gap-1">
            {site.sourceUrl ? (
              <p>
                <a className="underline" href={site.sourceUrl} target="_blank" rel="noreferrer">
                  {site.attribution} · {site.sourceRecordId}
                </a>
                {site.capacitySourceUrl ? (
                  <>
                    {" "}
                    ·{" "}
                    <a className="underline" href={site.capacitySourceUrl} target="_blank" rel="noreferrer">
                      Capacity source
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
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
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="text-sm">{latest ? callStatusForCoordinator(latest) : "Call this place"}</p>

      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-sm">
          Phone number
          {phoneRequired ? (
            <span className="text-red-700"> · required</span>
          ) : (
            <span className="text-foreground/55"> · optional</span>
          )}
        </label>
        <input
          id={fieldId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          className="h-8 rounded-md border bg-background px-2.5 text-sm"
          placeholder="600 111 222"
          value={number}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : `${fieldId}-hint`}
          onChange={(event) => {
            setNumber(event.target.value);
            if (error) setError(null);
          }}
        />
        <p id={`${fieldId}-hint`} className="text-sm text-foreground/50">
          {site.phoneOnFile
            ? "A number is already on file. Leave this blank to use it, or type another."
            : "Spaces are fine."}
        </p>
      </div>

      {error ? (
        <p id={errorId} className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {waiting ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="h-8 rounded-md bg-foreground px-3 text-sm text-background disabled:opacity-50"
            disabled={busy}
            onClick={() => post("approve")}
          >
            {busy ? "Starting…" : "Approve and dial"}
          </button>
          <button
            type="button"
            className="h-8 text-sm text-foreground/55 underline underline-offset-4 disabled:opacity-50"
            disabled={busy}
            onClick={() => post("request")}
          >
            Prepare again
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="h-8 w-fit rounded-md border px-3 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => post("request")}
        >
          {busy ? "Preparing…" : "Prepare this call"}
        </button>
      )}
    </div>
  );
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
  const saved = justSaved ?? site.protectiveAction;
  const [moreOpen, setMoreOpen] = useState(saved === "monitor" || saved === "latent");

  async function choose(action: ProtectiveAction) {
    const previous = site.protectiveAction;
    setBusy(action);
    setError(null);
    onPatchSite(site.id, { protectiveAction: action });
    setJustSaved(action);
    if (action === "monitor" || action === "latent") setMoreOpen(true);
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

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base">What should they do?</h2>

      <div className="flex flex-wrap items-center gap-2">
        {PRIMARY_ACTIONS.map((action) => {
          const selected = site.protectiveAction === action;
          const leave = action === "evacuate";
          return (
            <button
              key={action}
              type="button"
              disabled={busy !== null}
              aria-pressed={selected}
              onClick={() => choose(action)}
              className={cn(
                "h-8 rounded-md px-3 text-sm transition-colors disabled:opacity-50",
                leave
                  ? "bg-foreground text-background hover:bg-foreground/85"
                  : selected
                    ? "border border-foreground/40 bg-muted"
                    : "border border-foreground/15 bg-background hover:bg-muted/60",
              )}
            >
              {busy === action ? "Saving…" : actionUi[action].title}
              {selected && busy !== action ? " ✓" : ""}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((open) => !open)}
          className="h-8 px-1 text-sm text-foreground/50 hover:text-foreground/80"
        >
          More options
        </button>
      </div>

      {moreOpen ? (
        <div className="flex flex-wrap gap-2">
          {SECONDARY_ACTIONS.map((action) => {
            const selected = site.protectiveAction === action;
            return (
              <button
                key={action}
                type="button"
                disabled={busy !== null}
                aria-pressed={selected}
                onClick={() => choose(action)}
                className={cn(
                  "h-8 rounded-md border px-3 text-sm disabled:opacity-50",
                  selected
                    ? "border-foreground/40 bg-muted"
                    : "border-transparent text-foreground/60 hover:bg-muted/50",
                )}
              >
                {busy === action ? "Saving…" : actionUi[action].title}
                {selected && busy !== action ? " ✓" : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {saved && !error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-foreground/70">
            Saved: {actionUi[saved].title}.{" "}
            {actionUi[saved].unlocksCall ? "Prepare the call below." : "We will not call."}
          </p>
          {nextCount > 0 ? (
            <button type="button" className="h-8 text-sm underline underline-offset-4" onClick={onOpenNext}>
              Next place
            </button>
          ) : (
            <p className="text-sm text-foreground/50">Nothing else is waiting.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
