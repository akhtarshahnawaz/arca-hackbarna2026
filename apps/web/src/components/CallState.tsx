"use client";

import { useState } from "react";
import type { CallView } from "@/lib/api";
import { timeOfDay } from "@/lib/format";

/**
 * What happened when ARCA called.
 *
 * The voice leg was invisible in an earlier build: calls were dispatched,
 * polled, transcribed and fed back into the ranking, and none of it appeared on
 * screen. A system that acts on your behalf has to show you what it did in your
 * name, so every call carries its mode, its outcome, and — when telephony was
 * unavailable — the reason it fell back to a browser session instead.
 *
 * The transcript box beside it is the manual path. It exists because a
 * coordinator standing in a field with a phone to their ear is the most likely
 * way this information actually arrives, and because a demo should not depend
 * on a working telephony account to show the re-ranking that follows a call.
 */

export interface CallStateProps {
  calls: CallView[];
  onTranscript: (assetId: string, transcript: string) => Promise<void>;
  assetId: string;
  busy: boolean;
}

const TONE: Record<string, { colour: string; label: string }> = {
  dispatched: { colour: "var(--color-warn)", label: "Dialling" },
  answered: { colour: "var(--color-ok)", label: "On the line" },
  completed: { colour: "var(--color-ok)", label: "Call ended" },
  web_session: { colour: "var(--color-resource)", label: "Browser session" },
  failed: { colour: "var(--color-evacuate)", label: "Not placed" },
};

export function CallState(props: CallStateProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const calls = props.calls.filter((call) => call.siteId === props.assetId);
  const latest = calls[calls.length - 1] ?? null;

  const submit = async () => {
    if (!draft.trim()) return;
    await props.onTranscript(props.assetId, draft.trim());
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t hairline">
      {latest ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: TONE[latest.status]?.colour ?? "var(--color-ink-faint)" }}
            />
            <span style={{ color: TONE[latest.status]?.colour ?? "var(--color-ink-dim)" }}>
              {TONE[latest.status]?.label ?? latest.status}
            </span>
            <span className="text-[var(--color-ink-faint)]">
              {latest.mode === "web" ? "browser voice" : latest.phoneMasked}
            </span>
            <span className="num ml-auto text-[var(--color-ink-faint)]">
              {timeOfDay(latest.dispatchedAt)}Z
            </span>
          </div>

          {latest.error ? (
            <p className="text-[10px] leading-relaxed text-[var(--color-ink-faint)]">{latest.error}</p>
          ) : null}

          {latest.webSessionUrl ? (
            <a
              href={latest.webSessionUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[10px] text-[var(--color-resource)] hover:underline"
            >
              Open the voice session →
            </a>
          ) : null}

          {latest.transcript ? (
            <details className="text-[10px]">
              <summary className="cursor-pointer text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]">
                Transcript
              </summary>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[var(--color-ink-dim)]">
                {latest.transcript}
              </p>
            </details>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <div className="mt-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="What the site said. ARCA extracts people present, mobility and vehicles, then re-ranks."
            className="w-full resize-none rounded border border-[var(--color-line-bright)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-ink-faint)]"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              disabled={props.busy || draft.trim().length === 0}
              onClick={() => void submit()}
              title="Extract what the site said — people present, who cannot walk unaided, vehicles — and recompute the ranking on it. The list reorders and the diff names this call as the cause."
              className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-3)] hover:bg-[var(--color-line)] transition-colors disabled:opacity-40"
            >
              {props.busy ? "Applying…" : "Apply to ranking"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Type what the site told you on the phone. ARCA extracts the figures and re-ranks on them, exactly as it would from a call it placed itself."
          className="mt-1 text-[10px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
        >
          {latest ? "Add what they said" : "Log a call made by hand"}
        </button>
      )}
    </div>
  );
}
