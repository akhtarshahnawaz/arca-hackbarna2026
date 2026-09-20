import { EventEmitter } from "node:events";
import type { TimelineEvent } from "@arca/core";

/**
 * In-process pub/sub, used to push updates to open browser tabs.
 *
 * Every pipeline step publishes here, so the map, the ranked list and the
 * timeline move as work happens rather than when someone reloads. Kept
 * in-process because ARCA is a single agent service; a multi-instance
 * deployment would swap this for Redis Streams behind the same two methods,
 * which is the whole reason the surface is this small.
 */

export type BusEvent =
  | { type: "timeline"; incidentId: string; event: TimelineEvent }
  | { type: "incident"; incidentId: string; reason: string }
  | { type: "ranking"; incidentId: string; version: number; summary: string }
  | { type: "call"; incidentId: string; callId: string; status: string }
  | { type: "heartbeat"; at: string };

class Bus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A busy incident with several open tabs exceeds the default cap of ten,
    // and the resulting warning looks like a leak when it is really an audience.
    this.emitter.setMaxListeners(200);
  }

  publish(event: BusEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: (event: BusEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export const bus = new Bus();
