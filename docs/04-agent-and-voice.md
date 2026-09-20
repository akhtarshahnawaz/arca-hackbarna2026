# The agent, and the voice layer

## What the agent is for

Answering which sites are in danger, in what order, and why. The coordinator
decides everything.

Built on [Mastra](https://mastra.ai) over
[Nebius Token Factory](https://tokenfactory.nebius.com) through its
OpenAI-compatible endpoint.

## What it cannot do

It cannot place a phone call. Not by instruction — by construction. There is no
code path from the model to `VoiceService.dispatch` that does not pass through
`IncidentService.dispatchApprovedCall`, which writes a decision record naming an
actor before it does anything else.

`propose_call` raises an approval card and returns a sentence saying so. The
Telegram button and the web button both land on the same decision endpoint, so
there is one audit trail regardless of where the approval came from.

The instructions state this as a fact about the system rather than a plea,
because the model cannot dial whatever it decides, and saying so plainly is more
useful than asking it not to try.

## Tools

Read tools return formatted sentences, not raw records. Handing a model a JSON
blob invites it to do arithmetic on the numbers, and arithmetic is exactly what
it should not be doing — the ranking engine has already decided.

| Tool | Approval | Purpose |
|---|---|---|
| `list_incidents` | — | What is open, with confirmation scores |
| `get_incident` | — | Evidence, satellites, weather, totals |
| `get_ranked_sites` | — | The ranked list, filterable |
| `explain_site` | — | The arithmetic behind one row, with provenance |
| `explain_policy` | — | Thresholds and assumptions the engine used |
| `weather_at` | — | Wind and humidity for the next hours |
| `refresh_spread` | — | Fresh simulation and re-rank. Slow |
| **`propose_call`** | **yes** | Raises an approval card. Cannot dial |

## Two things it always repeats

- Capacity figures are registered maximums, not live occupancy.
- Valuations are parametric replacement-cost estimates for triage, not
  appraisals.

## The briefing

Every number is computed before the model is called, and the model is given them
as facts it may only rephrase. That rule is what makes the briefing safe to send
unprompted: **the language is generated, the content is not.**

If Nebius is unreachable or returns something unusable — empty, enormous, or
full of markdown furniture — a deterministic template containing exactly the
same facts goes out instead. A plainer briefing is a complete fallback; no
briefing is a missed fire.

The briefing is sent without being asked for, whenever a confirmed incident has
human-bearing sites. Silence is the failure mode the system exists to remove.

## Telegram

Implemented directly against the Bot API rather than through an adapter, because
the approval card is the safety-critical surface and it has to be the same
object the web UI approves. An adapter with its own approval concept would give
two paths, which is one more than can be audited.

- Long-polling in development, so no public URL is needed.
- Webhook in production, because polling does not survive a platform that sleeps
  idle containers.
- Only chat ids in `COORDINATOR_TELEGRAM_CHAT_IDS` see incident data or can
  authorise anything. Anyone else gets a plain explanation of what ARCA is and
  nothing about any incident.
- Voice notes are transcribed through SLNG, so a coordinator can drive it
  hands-free from a vehicle.

## Outbound voice

One SLNG voice agent, created once, driven with per-call variables.

The script identifies itself as an automated call from the coordination centre,
states the recommended action in one sentence, then asks exactly four questions:

1. How many people are there right now?
2. How many cannot walk unaided?
3. What vehicles do you have?
4. Do you need help evacuating?

### Two rails in front of every call

1. **`CALL_ALLOWLIST`** must contain the number, matched exactly against E.164
   after stripping spaces. No prefix matching, no wildcards — an allowlist that
   can be satisfied by a prefix is not an allowlist. **Empty by default**, which
   means no outbound calls at all.
2. **`EXERCISE_MODE`** is on by default and prefixes every message and call with
   "SIMULACRO".

### When a call cannot be placed

A browser voice session opens with the identical agent and script. The
conversation still happens, is still transcribed, and still re-ranks the list.
The record says `web`, so nobody later mistakes it for a phone call that reached
the site.

What never happens is a silent success. A call that did not happen is reported
as a call that did not happen, on the timeline and to the agent.

#### What LiveKit is, and why you have to join a room

SLNG runs its voice agents on **LiveKit** — the real-time audio layer that
carries the conversation. A **room** is one conversation, and the **token** is
a five-minute pass into it.

So `POST /v1/agents/{id}/web-sessions` does not return a web page you can open.
It returns this:

```json
{
  "call_id": "879a2a0a-…",
  "room_name": "agent-879a2a0a-…",
  "livekit_url": "wss://slng-ire31kqr.livekit.cloud",
  "livekit_token": "eyJhbGciOiJIUzI1NiIs…",
  "max_session_seconds": "300"
}
```

A URL and a credential. The agent is already in that room waiting; something
has to connect and talk to it. For a while ARCA stored those two fields and
told the operator to "join it from the SLNG dashboard", which is a failsafe
nobody can use — and the whole point of falling back to a browser session is
that the conversation still happens.

The web app now joins the room itself, with `livekit-client`: connect with the
url and token, publish the microphone, and attach the agent's audio track so
you can hear it.

**You take the part of the site.** You are the person who picked up the phone
at the care home. The agent reads the same script, asks the same four
questions, and what you say is transcribed and re-ranks the list exactly as a
real call would. It is the fastest way to show the whole voice loop without
dialling anyone, and it is what an empty `CALL_ALLOWLIST` gives you by design.

Two things that go wrong: the browser will ask for microphone permission, and
refusing it means the agent talks and cannot hear you — the panel says so
rather than sitting silent. And the token expires after five minutes, so a room
left open goes stale and needs a fresh approval.

### Where the voice leg appears on screen

An earlier build dispatched calls, polled them, transcribed them and fed the
result back into the ranking, and showed none of it. A system that acts on your
behalf has to show you what it did in your name, so every call is visible in
three places:

- **The lead card**, under the approve button: mode, outcome, and the reason if
  it fell back to a browser session.
- **The ranked row**, as a phone glyph beside the status chip, so a site ARCA
  has already spoken to does not look identical to one nobody has touched —
  whether or not the row is expanded.
- **The timeline**, with the actor who approved it and a masked number.

The web session link is a link, because the failsafe is useless if nobody can
find the session it opened. The transcript is one click away, under the call.

### Hearing the call that is not placed

`CALL_ALLOWLIST` is empty by default and should be. The cost is that an
approval opens a LiveKit room, synthesises nothing, and leaves you taking the
script on trust — so the one question anyone asks about a system that
telephones care homes had no answer in the product.

**Hear it**, beside every approve button, synthesises the opening through the
same voice the agent uses, on the same variables the call would get. Two things
it is careful not to imply: that a call happened, and that the whole call is
scripted. The panel shows the lines, says nobody was called, and marks where
the script ends and the conversation begins.

### Logging a call made by hand

Every site row carries a transcript box. Two reasons it exists and is not a
debug affordance:

- A coordinator standing in a field with a phone to their ear is the most likely
  way this information actually arrives.
- A demo should not depend on a working telephony account to show the
  re-ranking that follows a call.

It runs the identical extraction and re-rank as a transcript SLNG returned, and
the timeline records the source as `manual`.

## Extraction

Transcript to structured report, through Nebius with a JSON schema, validated
against a zod schema before anything reaches the ranking.

The schema is deliberately narrow. A voice agent that can write arbitrary text
into an incident record is a voice agent that can invent an evacuation. Fields
are nullable because "they did not say" and "they said zero" are different
answers, and conflating them would put an empty school at the top of the list.

The first prompt rule is number correction:

> "Doscientas… no, trescientas" is **300**, with a correction recorded noting
> that 200 was said first.

Spoken numbers get revised mid-sentence far more often than written ones. The
previous build stored 200 and sent help for the wrong number of animals.

A transcript that cannot be parsed produces **null, not a guess**, and the
timeline says the ranking is unchanged. A fabricated occupancy figure is worse
than no figure: it would silently outrank a real one and nobody would know which
number they were acting on.
