"use client";

import { useEffect, useState } from "react";
import { api, type IncidentSummary } from "@/lib/api";
import { BrandMark } from "./Brand";
import { ACTION_STYLE, compact, timeOfDay } from "@/lib/format";

/**
 * The landing screen.
 *
 * Also the honest answer to a demo problem: a wildfire system may have no
 * wildfire to show. Replay bundles are real recorded Catalan fires played back
 * through the identical pipeline, and they are labelled as replays everywhere
 * they appear so nothing can be mistaken for a live incident.
 */

export function IncidentPicker(props: {
  incidents: IncidentSummary[];
  onPick: (id: string) => void;
  onStarted: (id: string) => Promise<void>;
}) {
  const [bundles, setBundles] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);

  useEffect(() => {
    void api
      .replayBundles()
      .then((result) => setBundles(result.bundles))
      .catch(() => setBundles([]));
  }, []);

  const startReplay = async (name: string) => {
    setBusy(name);
    setError(null);
    try {
      const result = await api.startReplay(name);
      await props.onStarted(result.incidentId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const scanNow = async () => {
    setTicking(true);
    setError(null);
    try {
      await api.tick();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTicking(false);
    }
  };

  return (
    <main className="min-h-screen w-screen overflow-y-auto bg-[var(--color-ground)] px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <BrandMark size={30} />
            <h1 className="text-2xl text-[var(--color-ink)]" style={{ letterSpacing: "0.12em" }}>
              ARCA
            </h1>
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-ink-dim)] max-w-xl leading-relaxed">
            DeepFire says where a fire may go. Talaia says what is there. ARCA says who to call
            first, calls them once you approve, and re-ranks on what they say.
          </p>
        </header>

        <section className="mb-8">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
              Open incidents
            </h2>
            <button
              type="button"
              onClick={() => void scanNow()}
              disabled={ticking}
              className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] transition-colors disabled:opacity-40"
            >
              {ticking ? "Scanning…" : "Scan for fires now"}
            </button>
          </div>

          {props.incidents.length === 0 ? (
            <div className="panel p-5">
              <p className="text-sm text-[var(--color-ink-dim)]">No incidents are open.</p>
              <p className="mt-1 text-[11px] text-[var(--color-ink-faint)] leading-relaxed">
                That is the expected state most of the time. ARCA opens one only when a satellite
                cluster clears the confirmation score, so a flare or a quarry never becomes an
                incident. Scan now to check, or replay a recorded fire below.
              </p>
            </div>
          ) : (
            <ul className="grid gap-2">
              {props.incidents.map((incident) => (
                <li key={incident.id}>
                  <button
                    type="button"
                    onClick={() => props.onPick(incident.id)}
                    className="panel w-full text-left px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[var(--color-ink)] truncate">
                            {incident.name}
                          </span>
                          {incident.replay ? (
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-ink-dim)]">
                              replay
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                          {incident.status} · {incident.confirmation.distinctSources.length}{" "}
                          satellites · last seen {timeOfDay(incident.lastObserved)}Z
                        </div>
                      </div>

                      {incident.counts.shelterCandidates > 0 ? (
                        <Count
                          value={incident.counts.shelterCandidates}
                          label="out of time"
                          colour={ACTION_STYLE.SHELTER_CANDIDATE.colour}
                        />
                      ) : null}
                      {incident.counts.evacuateNow > 0 ? (
                        <Count
                          value={incident.counts.evacuateNow}
                          label="evacuate"
                          colour={ACTION_STYLE.EVACUATE_NOW.colour}
                        />
                      ) : null}
                      <Count
                        value={compact(incident.counts.people)}
                        label="people"
                        colour="var(--color-ink-dim)"
                      />
                      <span className="num text-sm text-[var(--color-ink-faint)] w-10 text-right">
                        {incident.confirmation.score}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {bundles.length > 0 ? (
          <section>
            <h2 className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)] mb-3">
              Replay a recorded fire
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {bundles.map((bundle) => (
                <li key={bundle}>
                  <button
                    type="button"
                    onClick={() => void startReplay(bundle)}
                    disabled={busy !== null}
                    className="panel w-full text-left px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50"
                  >
                    <div className="text-sm text-[var(--color-ink)]">
                      {bundle.replace(/-/g, " ")}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
                      {busy === bundle ? "Running the pipeline…" : "Recorded detections, real pipeline"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {error ? (
          <p className="mt-6 text-[11px] text-[var(--color-evacuate)]">{error}</p>
        ) : null}

        <footer className="mt-10 pt-5 border-t hairline text-[10px] text-[var(--color-ink-faint)] leading-relaxed max-w-xl">
          Capacity figures are registered maximums, not live occupancy. Valuations are parametric
          replacement-cost estimates for triage, not appraisals. ARCA never places a call without a
          recorded human approval.
        </footer>
      </div>
    </main>
  );
}

function Count(props: { value: number | string; label: string; colour: string }) {
  return (
    <div className="shrink-0 text-right">
      <div className="num text-sm" style={{ color: props.colour }}>
        {props.value}
      </div>
      <div className="text-[9px] text-[var(--color-ink-faint)]">{props.label}</div>
    </div>
  );
}
