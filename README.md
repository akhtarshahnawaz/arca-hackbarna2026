# ARCA

Coordinator console for wildfire values at risk. HackBarna AI Summit 2026, Norrsken House Barcelona.

People do not refuse to leave because they are careless. The dog is family. The goats are the rent.

Read `ARCA-PLAN.md` before extending this.

## Run

```bash
cp .env.example .env.local
# put Deepfire credentials in .env.local only
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What is real vs demo

- **Ranking** is real TypeScript. Filter likely/possible first; watch is a separate list. AI does not sort.
- **Hour polygons** are a labelled DEMO ensemble over Bages.
- **Deepfire** is wired for a token + Catalonia hotspot pull. If that fails, the UI stays on demo and says so.
- **Livestock registry** (`7bpt-5azk`) is queried for extra Bages farms. Seeded sites remain if the pull fails.
- **Approve Call** is disabled. Vonage is not in this pass.

## Rules on screen

- Ensemble language only: “in 7 of 10 runs, fire reaches within 3 h”.
- Capacity and confirmed headcount are separate.
- Negative spare time means the site is already behind.

No secrets belong in git. `.env*` is ignored except `.env.example`.

## Persistence (LibSQL)

ARCA stores coordinators, residents, confirmations, and Deepfire simulation ids in LibSQL / SQLite — the same engine Mastra uses for memory. Local file: `arca.db` via `DATABASE_URL=file:./arca.db`. That file survives a laptop reboot. Many cloud hosts wipe the disk on restart. For Sunday 17:30 uptime use **Turso** (hosted LibSQL) or a persistent volume so residents, confirmations, and simulation ids survive 3 AM restarts. Leave `TURSO_*` unset unless those credentials already exist. Seed nothing that looks like real personal data.

## Mastra + Nebius Token Factory

Create an API key in the [Token Factory](https://tokenfactory.nebius.com) UI and paste it into `.env.local` as `NEBIUS_API_KEY`. Default chat model is `Qwen/Qwen3-30B-A3B-Instruct-2507` (`NEBIUS_MODEL`). The ARCA agent explains ranking only; it never sorts the list.

```bash
nvm use 22 && npm run mastra:dev
npm run nebius:ping
```
