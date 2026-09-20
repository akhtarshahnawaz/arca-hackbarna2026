# ARCA documentation

Start with the [project README](../README.md) for what ARCA is and how to run
it. These pages cover how it works and why it is built this way.

| | |
|---|---|
| [01 — Architecture](./01-architecture.md) | Services, the incident lifecycle, the approval path, and how every upstream failure degrades |
| [02 — Detection and cleaning](./02-data-pipeline.md) | Sensors, masking, the confirmation score, ensemble → arrival bands |
| [03 — Ranking](./03-ranking.md) | Spare time, the evacuation model, protective actions, the diff |
| [04 — Agent and voice](./04-agent-and-voice.md) | Mastra tools, briefings, Telegram, SLNG calls, transcript extraction |
| [05 — HTTP API](./05-api.md) | Every endpoint, with the decision endpoint called out |
| [06 — Configuration](./06-configuration.md) | Every variable, and what leaving it out costs |
| [07 — Deploying to Railway](./07-deployment-railway.md) | Step by step, plus operating notes |
| [08 — Extending](./08-extending.md) | New regions, rules, detection sources, agent tools, stores |
| [09 — Testing and the demo](./09-testing-and-demo.md) | The suite, replay, the three-minute script |

## If you only read one thing

The safety model, in [Architecture](./01-architecture.md#the-one-safety-property-worth-stating-plainly):
the language model cannot place a phone call, because there is no code path from
it to the voice service that does not pass through a stored human decision.
