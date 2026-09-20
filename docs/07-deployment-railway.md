# Deploying to Railway, from the dashboard

The whole system on Railway, with no terminal. Three services in one project:

```text
Postgres
arca-agent
arca-web
```

About twenty minutes from an empty project to a coordinator getting a briefing
on their phone.

Two steps normally reach for the CLI, and both have a dashboard equivalent:

| Normally | Here |
|---|---|
| `railway run … db:push` | The agent's **Pre-deploy Command**, run once |
| `railway run … slng:create-agent` | The same Pre-deploy slot, borrowed once |

## Why both halves live here

The agent polls DeepFire on a timer, holds an in-process event bus, and streams
server-sent events to every open browser. None of that survives a serverless
function, so the agent needs a platform that keeps a process alive. Once it is
here, putting the web app beside it means one platform, one log stream, one
bill, and no cross-provider URL to keep in step.

Vercel still works for the web half if you prefer it — see the end.

## 0. Before you start

- A Railway account.
- This repository on GitHub.
- Credentials from [Configuration](./06-configuration.md). **None are required.**
  ARCA boots without any of them and says at startup what it cannot do.

---

## 1. Create the project

1. Open the [Railway dashboard](https://railway.com/dashboard).
2. **New Project → Empty Project**.
3. Open the project settings and rename it `arca`.

## 2. Add PostgreSQL

On the project canvas:

1. **+ New → Database → PostgreSQL**.
2. Wait until it shows as deployed.
3. Rename the service `Postgres` if Railway named it something else — the
   variable reference in step 3 uses that exact name.

No PostGIS. ARCA never asks the database a spatial question; every geometry
operation happens in `@arca/core` as a pure function, which is what keeps the
ranking testable against fixtures. See [Architecture](./01-architecture.md).

> Without a database ARCA still runs, in memory, and says so at boot. State is
> then lost on every restart — including cached simulations, which is the
> expensive thing to lose. Worth ten minutes to avoid.

## 3. Add `arca-agent`

1. **+ New → GitHub Repo**, connect GitHub if prompted, pick this repository.
2. If Railway offers **Add Variables** rather than deploying straight away,
   take it. Otherwise let the first deploy fail while you configure — it has no
   variables yet and nothing is lost.
3. Open the service, go to **Settings**, rename it `arca-agent`.

### Source and build

| Setting | Value |
|---|---|
| Root Directory | blank, or `/` |
| Build Command | `pnpm install --frozen-lockfile && pnpm --filter @arca/agent build` |
| Start Command | `pnpm --filter @arca/agent start` |
| Pre-deploy Command | `pnpm --filter @arca/db push:ci` |
| Pre-deploy Timeout | `300` |
| Serverless / App Sleeping | **Off** |
| Replicas | `1` |

The root stays at the monorepo root because this is a pnpm workspace: the
agent's build pulls `@arca/core` and `@arca/db` from the same tree, and a root
of `apps/agent` cannot see them. Railway supports per-service build and start
commands over one repository, which is how two services share this one.

**Leave PORT unset.** Railway injects a different one into each service and the
agent binds whatever it is given. Generating a domain then targets the right
port automatically, with nothing to keep in step.

**Serverless off is not optional here.** The watcher is a timer inside the
process; suspend the container and the fire feed stops with it. `arca-web` can
sleep freely.

### About that Pre-deploy Command

`pnpm --filter @arca/db push:ci` creates the schema. It runs after the build,
sees `DATABASE_URL` and the private network, and fails the deployment if the
schema cannot be applied — which is what you want, rather than an agent booting
against a database it cannot write to.

Two things to know, in order of how likely they are to bite:

**Use `push:ci`, not `push`.** Plain `drizzle-kit push` asks for confirmation
before any statement that could lose data. There is no terminal attached to a
pre-deploy container, so that prompt either hangs until the timeout or fails
outright. `push:ci` is the same command with `--force`.

**Clear it once the schema exists.** `--force` auto-approves destructive
statements, and a pre-deploy runs on *every* deployment. Leaving it set means a
future schema change could drop a column without anyone confirming it. Set it,
deploy once, confirm the tables exist, then empty the field.

### Watch paths

**Settings → Source → Watch Paths**, one per line:

```text
/apps/agent/**
/packages/**
```

A leading `/` that Railway strips is fine. With these set, a change to
`apps/web` alone will not redeploy the agent.

### Variables

**Variables → Raw Editor**, and paste. Everything below is optional except what
you actually want to work:

```dotenv
NODE_ENV=production
LOG_LEVEL=info

DATABASE_URL=${{Postgres.DATABASE_URL}}

# Detection. Without these, live mode is off and synthetic scenarios still work.
DEEPFIRE_CLIENT_ID=
DEEPFIRE_CLIENT_SECRET=

# Exposure. Without this, incidents open detection-only: no ranking.
TALAIA_URL=https://talaia.up.railway.app
TALAIA_API_KEY=

# Language. Without this, briefings use the deterministic template and
# transcripts are not extracted.
NEBIUS_API_KEY=
NEBIUS_MODEL=openai/gpt-oss-120b

# Voice. Without these, approvals are recorded but no call is placed.
SLNG_API_KEY=
SLNG_AGENT_ID=

# Telegram. Without these there is no proactive briefing; the web UI is fine.
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET_TOKEN=
COORDINATOR_TELEGRAM_CHAT_IDS=

# Safety rails. Both fail safe; leave them exactly like this to begin with.
CALL_ALLOWLIST=
EXERCISE_MODE=true

# What to watch.
AOI_BBOX=0.15,40.50,3.35,42.90
WATCH_INTERVAL_MINUTES=5
CLUSTER_LOOKBACK_HOURS=24
PLACE_LOOKUP=true

# Protects the whole API. See the note below before setting it.
OPS_TOKEN=
```

Three things that go wrong here:

- **Paste plain URLs.** A URL that arrives as Markdown — `[https://x](https://x)`
  — is stored literally and every request to it fails in a confusing way.
- **`${{Postgres.DATABASE_URL}}` must match the database service's name.** Safer
  still: **New Variable → Add Reference → Postgres → DATABASE_URL**, and let
  Railway build the reference.
- **Leave `CALL_ALLOWLIST` empty.** Empty means ARCA places no outbound call at
  all. Every approval still works and opens a browser voice session instead, so
  the whole workflow is exercised without dialling anyone.

### Generating the two secrets without a terminal

`OPS_TOKEN` and `TELEGRAM_WEBHOOK_SECRET_TOKEN` are shared secrets — any long
random string works. Your password manager's generator is the easiest source.

Or, in any browser's developer console, run this twice:

```js
[...crypto.getRandomValues(new Uint8Array(24))]
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("")
```

One value each. Do not reuse the same string for both.

> **`OPS_TOKEN` turns authentication on for the whole API.** It cannot be a
> `NEXT_PUBLIC_*` variable — that compiles it into a bundle anyone can read — so
> the web app asks for it once per browser and keeps it in local storage. You
> will see a small *This deployment is protected* prompt the first time you open
> the site. That is expected; paste the same value.
>
> Leave it empty and the API is open to anyone who can reach the URL, which is
> flagged in the boot log. For a hackathon demo that may be the right call; for
> anything carrying real facility phone numbers it is not.

### Deploy

Railway may hold these as staged changes. Click **Deploy** / **Apply Changes**,
then watch both **Build Logs** and **Deploy Logs**. The schema push should
complete before the agent starts.

The boot log lists every missing capability with what it costs:

```text
warn  TALAIA_API_KEY unset. Incidents open detection-only, with no exposure or ranking.
warn  CALL_ALLOWLIST is empty. Every approved call opens a browser voice session instead of dialling.
info  ARCA ready  storage=postgres detection=live exposure=true voice=web-sessions
```

## 4. Give the agent a domain

1. `arca-agent` → **Settings → Networking → Public Networking → Generate Domain**.
2. If asked for a target port, take the one Railway suggests.
3. Copy the full URL, e.g. `https://arca-agent-production.up.railway.app`.

Railway does not assign a public domain automatically; this step is required.

You end up with **two domains** and they do different jobs. Worth writing down
somewhere before you forget which is which:

| | Serves | You open it to |
|---|---|---|
| `arca-agent` domain | The JSON API and the event stream | Check `/api/health`; never for the UI |
| `arca-web` domain | The operations screen | Everything else |

The agent's domain is the value of `NEXT_PUBLIC_AGENT_URL` in step 5. Give the
short, memorable name to `arca-web` — that is the one people will actually type.

Then add one more variable to `arca-agent`, with **no trailing slash**:

```dotenv
AGENT_PUBLIC_URL=https://arca-agent-production.up.railway.app
```

Deploy the staged change. The agent needs its own address to register a Telegram
webhook — with it set, Telegram switches from long-polling to webhook mode,
which is what survives a platform that sleeps idle containers.

### Now clear the Pre-deploy Command

The schema exists. **Settings → Pre-deploy Command → empty it**, for the reason
in step 3. You can always put it back for a migration.

## 5. Add `arca-web`

1. **+ New → GitHub Repo → same repository**.
2. Rename it `arca-web`.

| Setting | Value |
|---|---|
| Root Directory | blank, or `/` |
| Build Command | `pnpm install --frozen-lockfile && pnpm --filter @arca/web build` |
| Start Command | `pnpm --filter @arca/web start` |
| Pre-deploy Command | none |
| Serverless / App Sleeping | fine to leave on |
| Replicas | `1` |

Watch paths:

```text
/apps/web/**
/packages/core/**
```

Variables:

```dotenv
NODE_ENV=production
NEXT_PUBLIC_AGENT_URL=https://arca-agent-production.up.railway.app
```

Use the real agent domain. **`NEXT_PUBLIC_*` is compiled into the JavaScript
bundle at build time**, so after changing it choose **Redeploy**, never merely
**Restart** — a restart serves the old bundle with the old URL baked in.

Then **Settings → Networking → Generate Domain** for this service too.

The agent sends permissive CORS headers, so the browser reaches it across
origins with nothing further to configure.

## 6. Check it worked

Open this in a browser:

```text
https://YOUR-AGENT-DOMAIN/api/health
```

> **This must be the agent's domain, not the web app's.** They are two services
> with two domains, and it is easy to reach for the one you have been opening
> all along. `arca-web` is a front end with exactly two routes — `/` and a 404
> page — so `/api/health` on it returns a **Next.js 404**, which looks alarming
> and means nothing. If the response says `x-powered-by: Next.js`, you are on
> the wrong domain: go to `arca-agent → Settings → Networking` and use the one
> listed there.

`/api/health` is deliberately exempt from `OPS_TOKEN`, so a platform health
check works. You should get something like:

```json
{
  "status": "ok",
  "storage": "postgres",
  "capabilities": {
    "deepfire": true, "talaia": true, "nebius": true, "slng": false,
    "telegram": true, "outboundCalls": false, "database": true,
    "exerciseMode": true
  },
  "upstream": { "deepfire": true, "talaia": true }
}
```

Read it as: `storage` must say `postgres`, not `memory`. Every `false` in
`capabilities` is a variable you left out — intentionally or not. `upstream`
is a live reachability check, so a `true` there means the credential actually
works rather than merely being present.

A 503 means DeepFire is configured but unreachable.

Then open the `arca-web` domain. You should get the operations screen: the feed
of active clusters on the left, each one scored, and the synthetic scenarios one
switch away. **An empty live feed is the normal state** — ARCA opens an incident
only above 60/100, so a flare or a quarry never becomes one. Switch to
**Synthetic** to see the whole pipeline work on a generated fire.

If something looks wrong, `arca-agent → Deployments → View Logs` and search for
`error`, `webhook`, `missing` or `database`.

## 7. Telegram

With `AGENT_PUBLIC_URL` and `TELEGRAM_BOT_TOKEN` both deployed, the agent
registers its webhook at startup. To confirm, open this in a **private** window
— the token is in the URL:

```text
https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo
```

The response should name your Railway agent domain with no recent error.

Then:

1. Message the bot from the coordinator's phone. It replies with that chat's id.
2. `arca-agent → Variables`:

   ```dotenv
   COORDINATOR_TELEGRAM_CHAT_IDS=123456789
   ```

   Comma-separated for several: `123456789,987654321`.
3. Redeploy.
4. **Message it from a phone that has never touched it.** It must explain what
   ARCA is and show nothing about any incident. If it shows a ranked list, the
   allow-list is not doing its job — stop and fix that before going further.

## 8. Create the SLNG voice agent, without a terminal

Only needed if you want outbound voice. It is a one-off: it creates an agent at
SLNG and prints an id.

There is no `SLNG_AGENT_ID` to look up before you have created one — the id is
minted when the agent is created, and this script is what creates it. A fresh
SLNG key lists no agents at all, so if you went looking for the id first and
found nothing, that is why. If you have already created one, skip to *Reading
back an id you already have* below.

Locally, with `SLNG_API_KEY` in your `.env`, this is the whole thing:

```bash
pnpm --filter @arca/agent slng:create-agent
```

The Railway route below is for doing it without a terminal.

**Borrow the Pre-deploy slot.** It runs exactly once per deployment, its output
lands in the deploy log, and nothing lingers afterwards.

1. `arca-agent → Variables`: set `SLNG_API_KEY` to your real key.
2. `arca-agent → Settings → Pre-deploy Command`:

   ```text
   pnpm --filter @arca/agent slng:create-agent
   ```
3. Deploy. Open **Deploy Logs** and find:

   ```text
   Voice agent created.

     SLNG_AGENT_ID=agt_...
   ```
4. Put that in `arca-agent → Variables` as `SLNG_AGENT_ID`.
5. **Empty the Pre-deploy Command again**, then redeploy.

> Step 5 is not tidiness. The script creates a *new* agent every time it runs —
> deliberately, so an agent mid-incident is never mutated underneath a call in
> progress. Left in pre-deploy it would mint another one on every deployment.

### Reading back an id you already have

`GET https://api.agents.slng.ai/v1/agents` lists the agents on your key.

**Not from a browser console.** Any request carrying an `authorization` header
triggers a CORS preflight, and SLNG sends no `Access-Control-Allow-Origin`, so
the browser refuses it before it leaves — whatever page you run it from. This
needs something that is not a browser:

```bash
curl -s -H "authorization: Bearer $SLNG_API_KEY" \
  https://api.agents.slng.ai/v1/agents
```

Look for the one named `arca-site-check` — the name this repo's script gives it
— and take its `id`. `[]` means you have not created one yet: go back to the
step above. A 401 means the key is wrong; the route itself is there.

No terminal at all? Put `curl` in the agent's Pre-deploy Command for one
deployment and read the output from the deploy log, the same trick as creating
it. Railway's own shell is a terminal too, if you have one open.

<details>
<summary>The temporary-service alternative, and why it is worse</summary>

You can instead add a fourth service from the same repo with a start command of
`pnpm --filter @arca/agent slng:create-agent`, read the id from its logs, then
delete it.

It works, but the script exits as soon as it has printed. Railway treats an
exited process as a crash and restarts it — **and each restart creates another
SLNG agent.** If you take this route, delete the service the moment you have the
id.

</details>

## 9. Outbound calls, last

Only after everything above is working:

```dotenv
CALL_ALLOWLIST=+34600000000
EXERCISE_MODE=true
```

E.164, exact match, no wildcards — an allow-list that can be satisfied by a
prefix is not an allow-list. Start with your own number. Keep `EXERCISE_MODE`
on: every call then opens by saying it is a drill.

---

## Operating notes

**Never sleep the agent.** The watcher stops with it.

**One agent replica.** The event bus is in-process and the watcher assumes a
single scanner. Two replicas means two scans and duplicated work on every tick.

**`NEXT_PUBLIC_*` needs a redeploy**, not a restart.

**Watch the token budget.** DeepFire tokens last 180 days and an account is
capped at five keys. ARCA persists its token in the database, so a redeploy does
not mint a new one — another reason to have Postgres attached.

**Costs.** Both services are small. Postgres is the only thing that grows, and
it grows slowly: incidents, timeline events and ranked sites.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `/api/health` returns a Next.js 404 page | You are on the **web** domain. The API lives on `arca-agent`, which has its own domain — `arca-agent → Settings → Networking` |
| `/api/health` returns Railway's own "Application not found" | No domain generated on `arca-agent` yet, or the service is not deployed |
| Deploy hangs in pre-deploy | Using `push` instead of `push:ci`; drizzle is waiting on a prompt that will never come |
| `storage: "memory"` on `/api/health` | `DATABASE_URL` unset or the reference does not match the Postgres service name |
| Web shows *This deployment is protected* | `OPS_TOKEN` is set. Paste the same value; it is stored in that browser |
| Every request 401s and no prompt appears | An old bundle. Redeploy `arca-web` rather than restarting it |
| Web loads but the feed is empty and errors | `NEXT_PUBLIC_AGENT_URL` wrong or stale — it is baked in at build time |
| Live feed empty, no errors | The normal state. Nothing has cleared the confirmation bar. See [Modes and the feed](./10-modes-and-the-feed.md) |
| Telegram silent | `AGENT_PUBLIC_URL` unset, has a trailing slash, or `COORDINATOR_TELEGRAM_CHAT_IDS` is empty |
| Approvals never dial | Expected. `CALL_ALLOWLIST` is empty, so every approval opens a browser voice session |

## Putting the web app on Vercel instead

It works, and the build config already handles it — `output: "standalone"` is
dropped when Vercel is detected, since Vercel uses its own adapter.

| Setting | Value |
|---|---|
| Root directory | `apps/web` |
| Build command | `pnpm --filter @arca/web build` |
| Install command | `pnpm install` |

With the same `NEXT_PUBLIC_AGENT_URL`. The agent still has to live somewhere
that keeps a process alive.
