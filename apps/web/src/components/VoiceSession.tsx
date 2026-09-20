"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";

/**
 * The browser voice session, made usable.
 *
 * When ARCA cannot dial — no number on file, or the allowlist is empty, which
 * is the default — SLNG opens a **LiveKit room** instead. LiveKit is the
 * real-time audio layer the voice agent runs on; a room is one conversation,
 * and the token is a five-minute pass into it. SLNG hands back a URL and a
 * token, not a web page, which is why this used to say "join it from the SLNG
 * dashboard" and leave it there.
 *
 * That was a failsafe nobody could use. The point of falling back to a browser
 * session is that *the conversation still happens*: the agent reads the same
 * script, asks the same four questions, and the transcript still comes back and
 * still re-ranks the list. None of that is worth anything if the coordinator
 * cannot get into the room.
 *
 * So this joins it. You take the part of the site — you are the person who
 * picked up the phone at the care home — and the agent talks to you exactly as
 * it would have talked to them.
 */

type Phase = "idle" | "connecting" | "live" | "ended" | "error";

export function VoiceSession(props: {
  room: { url: string; token: string; name: string | null };
  siteName: string;
  onEnded?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const leave = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    audioRef.current?.remove();
    audioRef.current = null;
  }, []);

  useEffect(() => leave, [leave]);

  const join = async () => {
    setPhase("connecting");
    setError(null);

    const room = new Room({ adaptiveStream: false, dynacast: false });
    roomRef.current = room;

    // The agent's voice arrives as a subscribed audio track; without attaching
    // it to an element nothing is heard and the session looks broken.
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return;
      const element = track.attach() as HTMLAudioElement;
      element.autoplay = true;
      element.style.display = "none";
      document.body.appendChild(element);
      audioRef.current = element;
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      setAgentSpeaking(speakers.some((speaker) => !speaker.isLocal));
    });

    room.on(RoomEvent.Disconnected, () => {
      setPhase("ended");
      props.onEnded?.();
    });

    try {
      await room.connect(props.room.url, props.room.token);
      // Publishing the microphone is what makes it a conversation rather than
      // a recording. The browser asks for permission at this point.
      await room.localParticipant.setMicrophoneEnabled(true);
      setPhase("live");
    } catch (cause) {
      setPhase("error");
      setError(
        cause instanceof Error
          ? /permission|NotAllowed/i.test(cause.message)
            ? "The browser refused microphone access. The agent will talk, but it cannot hear you."
            : cause.message
          : String(cause),
      );
    }
  };

  const toggleMute = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  };

  return (
    <div className="mt-2 rounded border border-[var(--color-resource)]/35 bg-[color-mix(in_oklab,var(--color-resource)_7%,transparent)] px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span
          className="mt-[3px] w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background:
              phase === "live"
                ? agentSpeaking
                  ? "var(--color-ok)"
                  : "var(--color-resource)"
                : "var(--color-ink-faint)",
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-[var(--color-ink)]">
            {phase === "live"
              ? agentSpeaking
                ? "The agent is speaking"
                : "Your turn — it is listening"
              : phase === "connecting"
                ? "Joining the room…"
                : phase === "ended"
                  ? "Session ended"
                  : "Browser voice session"}
          </div>

          {/* The thing nobody could work out from "a LiveKit room is open". */}
          <p className="mt-0.5 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
            {phase === "live" ? (
              <>
                You are standing in for {props.siteName}. Answer as they would — how many people are
                there, how many cannot walk unaided. What you say is transcribed and re-ranks the
                list, exactly as a real call would.
              </>
            ) : (
              <>
                No phone call was placed, so the agent is waiting in a room instead of on a line.
                Join it and you take the part of {props.siteName}: it reads the same script and asks
                the same four questions. Needs your microphone.
              </>
            )}
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-1.5 text-[9.5px] leading-relaxed text-[var(--color-warn)]">{error}</p>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        {phase === "idle" || phase === "error" ? (
          <button
            type="button"
            onClick={() => void join()}
            title="Connect your microphone and speak to the voice agent as though you were the site"
            className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-resource)]/50 text-[var(--color-resource)] hover:bg-[color-mix(in_oklab,var(--color-resource)_14%,transparent)] transition-colors"
          >
            Join and talk
          </button>
        ) : null}

        {phase === "live" ? (
          <>
            <button
              type="button"
              onClick={() => void toggleMute()}
              title={muted ? "Unmute your microphone" : "Mute your microphone"}
              className="text-[11px] px-2.5 py-1 rounded border border-[var(--color-line-bright)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors"
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              type="button"
              onClick={() => {
                leave();
                setPhase("ended");
              }}
              title="Leave the room. The transcript so far is kept."
              className="text-[11px] px-2.5 py-1 rounded text-[var(--color-ink-faint)] hover:text-[var(--color-ink-dim)] transition-colors"
            >
              End
            </button>
          </>
        ) : null}

        {phase === "connecting" ? (
          <span className="text-[10px] text-[var(--color-ink-faint)]">Connecting…</span>
        ) : null}

        {phase === "ended" ? (
          <span className="text-[10px] text-[var(--color-ink-faint)]">
            The transcript arrives on the timeline when SLNG finishes processing it.
          </span>
        ) : null}
      </div>
    </div>
  );
}
