"use client";

import { useState } from "react";
import { BrandMark } from "./Brand";
import { setOpsToken } from "@/lib/api";

/**
 * The door.
 *
 * `OPS_TOKEN` on the agent protects the whole API. It cannot travel as a
 * `NEXT_PUBLIC_*` variable — that compiles it into a bundle anyone can read —
 * so it lives in this browser's local storage and is entered once per device.
 *
 * This exists because the alternative is worse than it sounds: a protected
 * deployment with no prompt is a screen of 401 errors and nothing to click, and
 * the operator has no way to know a variable is even involved.
 *
 * Not an identity system, and it does not pretend to be. One deployment, one
 * operations room, one shared secret — what it buys is the difference between
 * "anyone who finds the URL" and "someone the team gave the token to", which is
 * the gap that matters when the payload carries facility phone numbers.
 */
export function TokenGate(props: { onSaved: () => void }) {
  const [value, setValue] = useState("");

  const save = () => {
    if (!value.trim()) return;
    setOpsToken(value);
    props.onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-ground)]/92 backdrop-blur px-6">
      <div className="panel w-full max-w-[420px] px-6 py-6">
        <div className="flex items-center gap-2.5 mb-4">
          <BrandMark size={24} />
          <span
            className="text-[15px] text-[var(--color-ink)]"
            style={{ letterSpacing: "0.12em" }}
          >
            ARCA
          </span>
        </div>

        <h1 className="text-[15px] text-[var(--color-ink)]">This deployment is protected.</h1>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-ink-dim)]">
          Paste the operations token. It is the <span className="num">OPS_TOKEN</span> set on the
          agent service, and it is kept in this browser only — it is never sent anywhere but the
          agent.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Operations token"
            aria-label="Operations token"
            className="mt-4 w-full rounded border border-[var(--color-line-bright)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none focus:border-[var(--color-ink-faint)]"
          />

          <button
            type="submit"
            disabled={value.trim().length === 0}
            className="mt-3 w-full rounded border border-[var(--color-line-bright)] bg-[var(--color-surface-3)] px-3 py-2 text-[12px] text-[var(--color-ink)] hover:bg-[var(--color-line)] transition-colors disabled:opacity-40"
          >
            Unlock
          </button>
        </form>

        <p className="mt-4 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
          If you are running this locally and did not set one, leave{" "}
          <span className="num">OPS_TOKEN</span> empty on the agent and reload — the API is then
          open to anyone who can reach it, which is flagged at boot.
        </p>
      </div>
    </div>
  );
}
