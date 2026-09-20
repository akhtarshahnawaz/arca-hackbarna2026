"use client";

/**
 * The ARCA mark.
 *
 * Three nested arcs over a point: the ensemble contours the product draws, and
 * an ark's hull. The mark is the thing the system actually shows you — a fire
 * front at three levels of agreement, spreading from an ignition — rather than
 * a decorative glyph bolted on afterwards.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <path d="M3.2 16.4a9.4 9.4 0 0 1 17.6 0" stroke="#fcd34d" strokeWidth="1.7" strokeLinecap="round" opacity="0.55" />
      <path d="M6 17.2a6.4 6.4 0 0 1 12 0" stroke="#fb923c" strokeWidth="1.8" strokeLinecap="round" opacity="0.8" />
      <path d="M8.8 18a3.5 3.5 0 0 1 6.4 0" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="18.6" r="1.5" fill="#ef4444" />
    </svg>
  );
}

/**
 * Wordmark plus what the product does, in five words.
 *
 * The line matters more than the logo: someone seeing this screen over a
 * shoulder should learn what it is without asking.
 */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0">
      <BrandMark size={compact ? 20 : 24} />
      <div className="leading-none">
        <div
          className="font-semibold text-[var(--color-ink)]"
          style={{ fontSize: compact ? 14 : 16, letterSpacing: "0.14em" }}
        >
          ARCA
        </div>
        {compact ? null : (
          <div className="mt-1 text-[9.5px] uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">
            Wildfire values at risk
          </div>
        )}
      </div>
    </div>
  );
}
