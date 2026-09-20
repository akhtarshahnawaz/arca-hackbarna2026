"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_URL, api, opsToken, type ScriptView } from "@/lib/api";

/**
 * Hear the call that is not being placed.
 *
 * `CALL_ALLOWLIST` is empty by default and should be. The cost of that is
 * that the most obvious question about a system which telephones care homes —
 * *what does it actually say* — had no answer anywhere in the product. An
 * approval opened a LiveKit room, synthesised nothing, and left you to take
 * the script on trust.
 *
 * This plays the opening through the same voice the agent uses, on the same
 * variables the call would get. Two things it is careful not to imply: that a
 * call happened, and that the whole call is scripted. It is the opening; the
 * rest is a conversation, and the panel says so rather than letting a tidy
 * transcript suggest otherwise.
 */
export function ScriptPreview(props: { incidentId: string; assetId: string; onClose: () => void }) {
  const [script, setScript] = useState<ScriptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .script(props.incidentId, props.assetId)
      .then((result) => {
        if (!cancelled) setScript(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
  }, [props.incidentId, props.assetId]);

  const play = () => {
    const existing = audioRef.current;
    if (existing) {
      if (playing) {
        existing.pause();
        setPlaying(false);
      } else {
        void existing.play();
        setPlaying(true);
      }
      return;
    }

    // The token rides as a query parameter: an <audio> element cannot set a
    // header, the same reason the event stream carries it that way.
    const token = opsToken();
    const url =
      `${AGENT_URL}/api/incidents/${encodeURIComponent(props.incidentId)}` +
      `/sites/${encodeURIComponent(props.assetId)}/script/audio` +
      (token ? `?token=${encodeURIComponent(token)}` : "");

    setLoadingAudio(true);
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener("canplaythrough", () => setLoadingAudio(false));
    audio.addEventListener("ended", () => setPlaying(false));
    audio.addEventListener("error", () => {
      setLoadingAudio(false);
      setPlaying(false);
      setError("Speech synthesis is unavailable on this deployment.");
    });
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => {
        setLoadingAudio(false);
        setError("The browser would not play the audio.");
      });
  };

  return (
    <div className="mt-2.5 rounded border border-[var(--color-line-bright)] bg-[var(--color-surface)] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={play}
          disabled={!script || script.audioAvailable === false}
          title={
            script?.audioAvailable === false
              ? "SLNG_API_KEY is not set on the agent, so there is no voice to synthesise with."
              : "Synthesise the opening in the agent's own voice. Nobody is called."
          }
          className="shrink-0 flex items-center gap-1.5 rounded px-2 py-1 text-[11px] border border-[var(--color-line-bright)] bg-[var(--color-surface-3)] hover:bg-[var(--color-line)] transition-colors disabled:opacity-40"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          {loadingAudio ? "Synthesising…" : playing ? "Pause" : "Hear it"}
        </button>

        <span className="text-[10px] text-[var(--color-ink-faint)] leading-tight">
          {script?.wouldDial
            ? "This is what the site will hear."
            : "Nobody is called. This is what they would hear."}
        </span>

        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close the script"
          className="ml-auto shrink-0 px-1 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
        >
          ×
        </button>
      </div>

      {error ? (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-warn)]">{error}</p>
      ) : null}

      {script ? (
        <div className="mt-2 space-y-1.5">
          {script.lines.map((line, index) =>
            line.role === "agent" ? (
              <p
                key={index}
                className="text-[11px] leading-relaxed text-[var(--color-ink-dim)] pl-2 border-l border-[var(--color-line-bright)]"
              >
                {line.text}
              </p>
            ) : (
              <p key={index} className="text-[9.5px] leading-snug text-[var(--color-ink-faint)]">
                {line.text}
              </p>
            ),
          )}
          {script.exerciseMode ? (
            <p className="text-[9.5px] text-[var(--color-warn)]">
              Exercise mode is on, so it opens by saying this is a drill.
            </p>
          ) : null}
        </div>
      ) : error ? null : (
        <p className="mt-2 text-[10px] text-[var(--color-ink-faint)]">Loading the script…</p>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 12 13" fill="none" aria-hidden="true">
      <path d="M2 1.5v10l9-5-9-5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="9" height="10" viewBox="0 0 10 12" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="3.2" height="12" rx="1" fill="currentColor" />
      <rect x="6.8" y="0" width="3.2" height="12" rx="1" fill="currentColor" />
    </svg>
  );
}
