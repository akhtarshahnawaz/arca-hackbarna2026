# Extending ARCA

The system is built so that the common extensions are new files rather than new
architecture. This page covers the ones most likely to be wanted.

## Change a decision rule

Never edit the logic first. All three policy files are read at startup, served
by `GET /api/policy`, and quoted by the agent's `explain_policy` tool, so
changing one moves the engine and the explanation together.

| To change | Edit |
|---|---|
| Mask buffers, duplicate radius, confirmation points | `packages/core/src/config/cleaning-policy.json` |
| Probability floor, horizon, action thresholds | `packages/core/src/config/ranking-policy.json` |
| Evacuation minutes per site type or species | `packages/core/src/config/evac-times.json` |

## Add a protective action

1. Add the variant to `ProtectiveAction` in `packages/core/src/domain/types.ts`.
2. Add a branch to `decideAction` in `ranking/actions.ts`. **Order matters** —
   read the comment there before inserting one.
3. Add a label, colour and one-line help to `ACTION_LABELS`, `ACTION_SEVERITY`
   and `apps/web/src/lib/format.ts`.
4. Add a case to `describeAction` in `apps/agent/src/voice/slng.ts` for each
   language, so a call can actually deliver it.
5. Write the test that says when it should fire.

The colour table in `format.ts` is the single source of truth for what an action
looks like anywhere on screen. Duplicating it into the map layer is how a legend
ends up lying about what a colour means.

## Add a new region

ARCA is not Catalonia-specific; only the default bounding box is.

```bash
AOI_BBOX=-9.50,35.90,4.40,43.90   # Spain
AOI_BBOX=-9.55,36.95,-6.18,42.15  # Portugal
```

Keep it tight. A broad-area query with a large limit and no other filter is the
one shape that reliably exceeds DeepFire's 30-second budget.

Exposure depth follows Talaia's coverage, and every response states which regime
it is in. Outside Spain that is OpenStreetMap plus the pan-European population
grid, which is thinner but still ranks.

## Add a detection source

DeepFire already fuses fifteen sensors, so this is usually about cross-checking
rather than adding coverage.

1. Fetch into the `Hotspot` shape in `packages/core/src/domain/types.ts`.
2. Add the sensor to `SENSORS` in `cleaning/sources.ts` with its true pixel
   size. That size drives the mask buffer and the duplicate radius, so guessing
   it wrong silently changes the cleaning behaviour.
3. Merge into the array passed to `cleanHotspots`. Everything downstream works
   unchanged.

For corroboration from an independent feed such as NASA FIRMS, add a component
to `confirmationScore` rather than mixing the detections in. Keeping the score's
components named and separate is what makes it explainable.

## Add a tool the agent can use

Tools live in `apps/agent/src/agent/tools.ts`.

```ts
const myTool = createTool({
  id: "my_tool",
  description: "One sentence on when to use this. The model reads it.",
  inputSchema: z.object({ incidentId: z.string() }),
  outputSchema: z.object({ summary: z.string() }),
  execute: async (input) => ({ summary: "…" }),
});
```

Two conventions worth keeping:

- **Return sentences, not records.** Handing a model a JSON blob invites it to
  do arithmetic on the numbers, and arithmetic is what the ranking engine has
  already done.
- **Anything irreversible goes through a decision record.** Do not call an
  external side effect from a tool. Raise an approval and let
  `IncidentService` execute it, so there stays exactly one auditable path.

## Swap the store

Implement the `Store` interface in `packages/db/src/store.ts` and return it from
`createStore`. `MemoryStore` is the reference implementation, and two behaviours
are load-bearing rather than incidental:

- A re-rank preserves `status` and `reported`. Those belong to the coordinator's
  workflow, not to the ranking pass.
- `latestSpreadRun` prefers a **completed** run over a newer **failed** one. The
  ranking needs the best geometry available, not the most recent attempt.

A store that quietly dropped either would pass a smoke test and lose the
operator's work during an incident.

## Run multiple agent instances

Today: do not. The event bus is in-process and the watcher assumes a single
watermark holder, so two instances would double-submit simulations against
DeepFire's two-in-flight budget.

To do it properly, replace `apps/agent/src/bus.ts` with Redis Streams behind the
same `publish` / `subscribe` pair, and move the watcher tick behind an advisory
lock. The bus surface is two methods precisely so this stays a small change.

## Record a replay bundle from real data

The shipped bundle is generated and says so in every field that matters. To
capture a real fire, write the same shape from live API responses:

```ts
{
  name, synthetic: false, clusterId, position, firstObserved, lastObserved,
  hasPerimeter, staticSources[], hotspots[], simulation, exposure
}
```

Find a fire with the DeepFire MCP server, which needs no credentials:

```bash
curl -s -X POST https://api.deepfire.co/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-03-26","capabilities":{},
        "clientInfo":{"name":"arca","version":"1"}}}'
```

Then `tools/call` `deepfire_search_fires` with a bounding box and a time window.
Real Catalan fires from 2026 include Calonge i Sant Antoni (4 July, 591
detections), La Pobla de Mafumet (18 September, beside the Tarragona
petrochemical complex — a good static-source demonstration), Vilaller and
Alfarràs.

Note that DeepFire's fire names can be wrong: one labelled "Manresa" is in
Huesca.

## Add a language

1. Extend `describeAction` in `apps/agent/src/voice/slng.ts`.
2. Create a second SLNG agent with that `language` and prompt; select it by the
   `language` field on the decision.
3. The coordinator-facing agent already answers in whatever language it is
   written to.
