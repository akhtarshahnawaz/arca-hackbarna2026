"use client";

import { useMemo } from "react";
import type { RankedSite, RankingDiff, TimelineEvent } from "@arca/core";
import type { CallView } from "@/lib/api";
import { minutes, timeOfDay, titleCase } from "@/lib/format";

/**
 * Everything that has ever happened to one site.
 *
 * The incident timeline answers "what has ARCA been doing"; this answers "what
 * do we know about this place, and what have we already said to it" — which is
 * the question you have just before picking up a phone, and the one that was
 * hardest to answer. The evidence was all there and scattered across four
 * places: the call record in one panel, the phone report inside an expanded
 * row, the ranking movement in a diff nobody looked at, and the rest buried in
 * a chronological feed of the whole incident.
 *
 * Timeline events are matched by name rather than by id, because ARCA's
 * timeline is keyed to the incident and most entries name the site in their
 * text. Crude, and it does mean a site whose name is a substring of another's
 * can pick up a stray line — which is a better failure than silently hiding
 * the call you are about to duplicate.
 */

export function SiteHistory(props: {
  site: RankedSite;
  calls: CallView[];
  timeline: TimelineEvent[];
  diffs: Array<RankingDiff & { at: string }>;
  onShowAll: () => void;
}) {
  const { site } = props;

  const calls = useMemo(
    () =>
      props.calls
        .filter((call) => call.siteId === site.assetId)
        .sort((a, b) => Date.parse(a.dispatchedAt) - Date.parse(b.dispatchedAt)),
    [props.calls, site.assetId],
  );

  const mentions = useMemo(
    () =>
      props.timeline
        .filter((event) => event.message.includes(site.name))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [props.timeline, site.name],
  );

  const movements = useMemo(
    () =>
      props.diffs
        .flatMap((diff) =>
          diff.entries
            .filter((entry) => entry.siteId === site.assetId)
            .map((entry) => ({ ...entry, at: diff.at })),
        )
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    [props.diffs, site.assetId],
  );

  const phone = site.contacts?.phone?.[0] ?? null;

  return (
    <div className="space-y-3">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] text-[var(--color-ink)] truncate">{site.name}</h3>
          <p className="text-[10px] text-[var(--color-ink-faint)]">
            {titleCase(site.subcategory)}
            {site.contacts?.operator ? ` · ${site.contacts.operator}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onShowAll}
          className="shrink-0 text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
        >
          All activity
        </button>
      </header>

      <Section title="Where we stand">
        <Line label="Status" value={titleCase(site.status)} />
        <Line
          label="People"
          value={`${site.peopleEstimate} · ${
            site.evac.basis === "reported"
              ? "reported by phone"
              : site.evac.basis === "registered"
                ? "registered capacity"
                : "estimated for this kind of site"
          }`}
        />
        <Line label="Fire arrives" value={minutes(site.arrivalMinutes)} />
        <Line label="Moving them takes" value={minutes(site.evac.minutes)} />
        {site.evac.livestockMinutes > 0 ? (
          <Line label="Moving the animals" value={minutes(site.evac.livestockMinutes)} />
        ) : null}
        <Line label="Phone" value={phone ?? "none on file"} />
      </Section>

      <Section title={`Calls (${calls.length})`}>
        {calls.length === 0 ? (
          <p className="text-[10px] text-[var(--color-ink-faint)]">
            Nobody has spoken to this site. Approving a call is what starts that.
          </p>
        ) : (
          calls.map((call) => (
            <div key={call.id} className="rounded border hairline px-2 py-1.5">
              <div className="flex items-baseline gap-1.5 text-[10px]">
                <span className="num text-[var(--color-ink-faint)]">
                  {timeOfDay(call.dispatchedAt)}Z
                </span>
                <span className="text-[var(--color-ink-dim)]">
                  {call.mode === "web" ? "browser voice session" : call.phoneMasked}
                </span>
                <span className="ml-auto text-[var(--color-ink-faint)]">
                  {call.status.replace(/_/g, " ")}
                </span>
              </div>
              {call.error ? (
                <p className="mt-1 text-[9.5px] leading-snug text-[var(--color-ink-faint)]">
                  {call.error}
                </p>
              ) : null}
              {call.transcript ? (
                <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-[var(--color-ink-dim)] pl-2 border-l hairline">
                  {call.transcript}
                </p>
              ) : null}
            </div>
          ))
        )}
      </Section>

      {site.reported ? (
        <Section title="What they told us">
          {site.reported.peoplePresent !== null ? (
            <Line label="People present" value={String(site.reported.peoplePresent)} />
          ) : null}
          {site.reported.nonAmbulatory ? (
            <Line label="Cannot walk unaided" value={String(site.reported.nonAmbulatory)} />
          ) : null}
          {site.reported.vehicles.length > 0 ? (
            <Line label="Vehicles" value={site.reported.vehicles.join(", ")} />
          ) : null}
          {site.reported.needsHelp !== null ? (
            <Line label="Needs help" value={site.reported.needsHelp ? "yes" : "no"} />
          ) : null}
          {site.reported.corrections.map((correction) => (
            <p key={correction} className="text-[9.5px] text-[var(--color-ink-faint)]">
              {correction}
            </p>
          ))}
          {site.reported.confidence < 0.5 ? (
            <p className="text-[9.5px] text-[var(--color-warn)]">
              Low confidence: the line was unclear. Treat as unconfirmed.
            </p>
          ) : null}
        </Section>
      ) : null}

      {movements.length > 0 ? (
        <Section title="How its position changed">
          {movements.map((move, index) => (
            <div key={`${move.siteId}-${index}`} className="text-[10px] leading-relaxed">
              <span className="num text-[var(--color-ink-faint)]">{timeOfDay(move.at)}Z </span>
              <span className="text-[var(--color-ink-dim)]">{move.reason}</span>
            </div>
          ))}
        </Section>
      ) : null}

      <Section title="Mentions on the timeline">
        {mentions.length === 0 ? (
          <p className="text-[10px] text-[var(--color-ink-faint)]">
            Nothing on the incident timeline names this site yet.
          </p>
        ) : (
          mentions.slice(0, 12).map((event) => (
            <div key={event.id} className="text-[10px] leading-relaxed">
              <span className="num text-[var(--color-ink-faint)]">{timeOfDay(event.at)}Z </span>
              <span className="text-[var(--color-ink-dim)]">{event.message}</span>
            </div>
          ))
        )}
      </Section>

      {site.provenance.length > 0 ? (
        <Section title="Where the figures came from">
          <p className="text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
            {site.provenance.map((entry) => entry.source_id).join(", ")}. {site.evac.assumptions.join("; ")}.
          </p>
        </Section>
      ) : null}
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[9px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)] mb-1.5">
        {props.title}
      </h4>
      <div className="space-y-1">{props.children}</div>
    </section>
  );
}

function Line(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[10.5px]">
      <span className="text-[var(--color-ink-faint)] shrink-0">{props.label}</span>
      <span className="text-[var(--color-ink-dim)] text-right">{props.value}</span>
    </div>
  );
}
