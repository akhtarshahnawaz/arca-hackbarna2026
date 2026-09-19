"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { siteKindLabel } from "@/lib/demo-data";
import { confirmedCopy, freshnessLabel, formatClock, registeredCopy } from "@/lib/freshness";
import { ensembleReachCopy, formatHours, spareTimeCopy } from "@/lib/ranking";
import type { CommandState, RankedSite } from "@/lib/types";
import { cn } from "@/lib/utils";

const CommandMap = dynamic(() => import("@/components/command-map"), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-none" />,
});

type Props = {
  initial: CommandState;
};

export function CommandConsole({ initial }: Props) {
  const [state] = useState(initial);
  const [selectedId, setSelectedId] = useState(
    initial.sites[0]?.id ?? initial.watch?.[0]?.id ?? null,
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  const watchSites = state.watch ?? [];

  const selected = useMemo(() => {
    return (
      state.sites.find((site) => site.id === selectedId) ??
      watchSites.find((site) => site.id === selectedId) ??
      state.sites[0] ??
      watchSites[0] ??
      null
    );
  }, [selectedId, state.sites, watchSites]);

  function selectSite(id: string) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setMobileOpen(true);
    }
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex flex-col gap-4 border-b px-5 py-4 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">
              Coordinator console
            </p>
            <h1 className="font-heading text-3xl tracking-tight">ARCA</h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              People do not refuse to leave because they are careless. The dog is family.
              The goats are the rent. Filter first, then spare time. AI only explains.
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 md:items-end">
            <Badge variant="outline">INC-DEMO Bages</Badge>
            <p className="font-mono text-xs text-muted-foreground">
              {state.fire.municipality} · {state.fire.ensembleMembers} runs · {state.fire.horizonHours} h
            </p>
          </div>
        </div>
        <FreshnessStrip state={state} />
      </header>

      {state.banners.length > 0 ? (
        <div className="flex flex-col gap-1 border-b bg-muted/40 px-5 py-2 md:px-8">
          {state.banners.map((banner) => (
            <p key={banner} className="text-xs text-muted-foreground">
              {banner}
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="relative min-h-[52dvh] lg:min-h-0">
          <CommandMap state={state} selectedId={selectedId} onSelect={selectSite} />
          <div className="pointer-events-none absolute top-4 left-4 rounded-md border bg-background/90 px-3 py-2">
            <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
              Demo polygons
            </p>
            <p className="text-xs text-foreground">Hour rings from member 5 of 10</p>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-t lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Ranked sites
              </p>
              <p className="text-sm text-muted-foreground">
                Likely and possible only. Spare time, then reach. Formula, not a model.
              </p>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{state.sites.length}</span>
          </div>
          <Separator />
          <ScrollArea className="h-[40dvh] lg:h-auto lg:flex-1">
            <ol className="flex flex-col">
              {state.sites.length === 0 ? (
                <li className="px-5 py-4 text-sm text-muted-foreground">
                  No likely or possible sites in this briefing.
                </li>
              ) : (
                state.sites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    selected={selected?.id === site.id}
                    onSelect={selectSite}
                    showRank
                  />
                ))
              )}
            </ol>
            <div className="border-t px-5 pt-4 pb-2">
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                Watch
              </p>
              <p className="text-sm text-muted-foreground">
                Below 3 in 10 runs. Not in the ranking — a 1/10 site cannot win the list.
              </p>
            </div>
            <ol className="flex flex-col pb-2">
              {watchSites.length === 0 ? (
                <li className="px-5 py-3 text-sm text-muted-foreground">
                  No watch sites in this briefing.
                </li>
              ) : (
                watchSites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    selected={selected?.id === site.id}
                    onSelect={selectSite}
                    showRank={false}
                  />
                ))
              )}
            </ol>
          </ScrollArea>
          <div className="hidden border-t lg:block">
            {selected ? <SiteDetail site={selected} /> : null}
          </div>
        </aside>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto lg:hidden">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>{selected.code}</SheetTitle>
                <SheetDescription>
                  {siteKindLabel(selected.kind)} · {selected.municipality}
                </SheetDescription>
              </SheetHeader>
              <SiteDetail site={selected} showHeader={false} />
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FreshnessStrip({ state }: { state: CommandState }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Every answer is only as fresh as its oldest input. Fire moves in minutes. The farm book does not.
      </p>
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

function SiteRow({
  site,
  selected,
  onSelect,
  showRank,
}: {
  site: RankedSite;
  selected: boolean;
  onSelect: (id: string) => void;
  showRank: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(site.id)}
        className={cn(
          "flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/60",
          selected && "bg-muted",
        )}
      >
        <span className="font-mono w-6 pt-0.5 text-xs text-muted-foreground">
          {showRank ? site.rank : "–"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-medium">{site.code}</span>
            <Badge variant="outline">{siteKindLabel(site.kind)}</Badge>
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {site.municipality} · {ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival)}
          </span>
        </span>
        <SpareChip site={site} />
      </button>
    </li>
  );
}

function SpareChip({ site }: { site: RankedSite }) {
  const urgent = site.spareTime !== null && site.spareTime < 0;
  return (
    <span className="flex flex-col items-end gap-1">
      <Badge variant={urgent ? "destructive" : "secondary"}>
        {site.spareTime === null ? "No reach" : formatHours(site.spareTime)}
      </Badge>
      <span className="font-mono text-[10px] text-muted-foreground">{site.label}</span>
    </span>
  );
}

function SiteDetail({
  site,
  showHeader = true,
}: {
  site: RankedSite;
  showHeader?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      {showHeader ? (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
            Site {site.code}
          </p>
          <h2 className="text-lg font-medium tracking-tight">
            {siteKindLabel(site.kind)} · {site.municipality}
          </h2>
          <p className="text-sm text-muted-foreground">{site.notes}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{site.notes}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Metric label="Spare time" value={site.spareTime === null ? "—" : formatHours(site.spareTime)} />
        <Metric label="Evac assumption" value={formatHours(site.tEvac)} />
      </div>
      <p className="text-sm leading-relaxed">{spareTimeCopy(site.spareTime)}</p>
      <p className="text-sm">{ensembleReachCopy(site.runsReach, site.ensembleMembers, site.tArrival)}</p>
      <p className="font-mono text-[11px] text-muted-foreground">
        Reach {site.label} · {Math.round(site.pReach * 10)} in 10 runs
      </p>

      <Separator />

      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Animals
        </p>
        {site.animals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No animals registered at this site.</p>
        ) : (
          site.animals.map((animal) => (
            <div key={animal.species} className="flex flex-col gap-1 text-sm">
              <p className="font-medium capitalize">{animal.species}</p>
              <p className="text-muted-foreground">
                Registered capacity {animal.registeredCapacity ?? "—"} · {registeredCopy(site.capacityUpdatedAt)}
              </p>
              <p className={animal.confirmedCount === null ? "text-destructive" : "text-foreground"}>
                Headcount {animal.confirmedCount ?? "—"} ·{" "}
                {confirmedCopy(site.confirmedAt, site.confirmationStatus)}
              </p>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Transport
        </p>
        <p>
          {site.hasOwnTransport === null
            ? "Own transport unknown. Ask."
            : site.hasOwnTransport
              ? "Can move some animals themselves."
              : "No own transport. Send a pickup."}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
          Shelter that takes animals
        </p>
        <p>{site.shelterHint}</p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Minimal personal data. Site codes and counts only. No names or phones in this briefing.
      </p>

      <LogOutcome key={site.id} site={site} />
    </div>
  );
}

function LogOutcome({ site }: { site: RankedSite }) {
  const defaultSpecies = site.animals[0]?.species ?? "sheep";
  const [species, setSpecies] = useState(defaultSpecies);
  const [count, setCount] = useState(
    site.animals[0]?.confirmedCount !== null && site.animals[0]?.confirmedCount !== undefined
      ? String(site.animals[0].confirmedCount)
      : "",
  );
  const [truck, setTruck] = useState(site.hasOwnTransport === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(count);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a non-negative count from the call.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: site.code,
          species,
          count: parsed,
          hasTransport: truck,
        }),
      });
      if (!response.ok) {
        setError("Could not save the report.");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not save the report.");
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit}>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Coordinator calls. ARCA does not place the call. Log what they told you — reported, not
        verified. Telegram works the same way.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          Species
        </span>
        <input
          className="rounded-md border bg-background px-3 py-2"
          value={species}
          onChange={(event) => setSpecies(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          Reported count
        </span>
        <input
          className="rounded-md border bg-background px-3 py-2"
          inputMode="numeric"
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={truck}
          onChange={(event) => setTruck(event.target.checked)}
        />
        Has a truck / own transport
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Saving report…" : "Log outcome"}
      </Button>
    </form>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">{label}</p>
      <p className="font-mono text-xl tracking-tight">{value}</p>
    </div>
  );
}
