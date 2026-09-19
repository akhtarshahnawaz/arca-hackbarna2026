# PENDING — ARCA Sunday demo

Actionable leftovers. Do **not** put phone numbers, Telegram tokens, API keys, Vonage secrets, or anything from `.env.local` in git.

## Blockers for the live 3-phone demo

- **Get Telegram chat ids.** Coordinator and Melissa (resident) must each send `/start` to `@arca_coordinator_bot`. Paste the numeric `chat.id` into `COORDINATOR_TELEGRAM_CHAT_ID` and `DEMO_RESIDENT_TELEGRAM_CHAT_ID` in `.env.local`. Spanish mobiles are **not** chat ids. How: briefly stop `mastra:dev` so `getUpdates` is not eaten, or read `ARCA Telegram DM role=...` in the Mastra log.
- **`SLNG_API_KEY` is still empty.** No real spoken voice without it.
- **Public `VONAGE_VOICE_WEBHOOK_URL`** (deploy or tunnel). Vonage cannot hit localhost. No public URL = no real call and no transcript.
- **Mobile hotspot** as venue-wifi backup.
- **After chat ids + SLNG + webhook:** rehearse the scripted fire **3 times** (reset → alert → Evacuate → Approve → live ring → 350 sheep / no truck → resident confine message).

## Safety / Galtea (save traces; do not need more data today)

- **Save Studio traces:**
  1. Agent claimed a call was in progress when the path was stubbed.
  2. Invented `633…` = `REGA-B-1842` with no data.
  These are the best Galtea findings. Capture before/after after the locks.
- **History leak:** digits `633209158` are already in pushed commit `e6429b1` on `origin/main` and `origin/viktoria`. Working tree is clean. Rewriting needs `git filter-repo` — **not done unless asked**.
- **Stranger test today:** message the bot cold from a phone that never touched it. Must explain ARCA politely and never show the briefing or allow calls. Only `COORDINATOR_TELEGRAM_CHAT_ID` can see briefings.

## Product locks already done (status so this list is not confusing)

These are **done**. They stay here so nobody re-opens them as pending:

- Call refused until Confine / Evacuate is in the DB.
- Typed “Call” is not approval; the Approve button dials.
- Stub says `SAY_THIS_EXACTLY`: Test mode, no call placed.
- Disclosure line is in the TTS code.
- One Approve covers the retry plan (max 3).
- Phones live only in `.env.local` (`DEMO_PHONE` Viktoria / farmer, `DEMO_RESIDENT_PHONE` Melissa, `COORDINATOR_PHONE`).
- `npm run demo:reset` exists: wipes decisions / pending calls / last-run reports; keeps Galtea traces and archived successful call evidence.
- Stranger lock in code when coordinator chat id is set; unset → Telegram coordinator tools fail closed.

## `demo:reset` reminder

- Run `npm run demo:reset` **before every rehearsal** so leftover Confine does not skip step 3.
- Do **not** wipe Galtea before/after traces or a real successful call log — judges may ask.

## Do not commit

- `.env.local`
- `.vonage/private.key`
- Any secrets or files that contain demo phone digits
