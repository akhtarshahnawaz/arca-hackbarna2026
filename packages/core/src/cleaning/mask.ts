import { bboxContains, bboxOfGeometry, expandBBox, pointInGeometry } from "../geo/index.js";
import type { BBox, Position } from "../geo/index.js";
import type { SensorClass, StaticHeatSource } from "../domain/types.js";
import { cleaningPolicy } from "../config/index.js";

interface IndexedSource {
  source: StaticHeatSource;
  /** One pre-expanded bbox per sensor class, so the hot loop only compares. */
  boxes: Record<SensorClass, BBox>;
}

/**
 * Spatial index over the persistent-anomaly mask.
 *
 * Spain's mask is a few thousand polygons and an incident brings a few thousand
 * hotspots, so the naive form is a few million polygon tests per tick. Screening
 * on a pre-expanded bounding box first turns almost all of those into four
 * numeric comparisons, and the buffer is baked into the box because the buffer
 * depends on the sensor, not on the source.
 */
export class StaticSourceIndex {
  private readonly entries: IndexedSource[] = [];

  constructor(sources: StaticHeatSource[]) {
    const buffers = cleaningPolicy.staticSourceBufferMeters;
    for (const source of sources) {
      const base = bboxOfGeometry(source.geometry);
      if (!base) continue;
      const boxes = {} as Record<SensorClass, BBox>;
      for (const [sensorClass, meters] of Object.entries(buffers) as Array<[SensorClass, number]>) {
        boxes[sensorClass] = expandBBox(base, meters);
      }
      this.entries.push({ source, boxes });
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * The static source a detection sits on, or null.
   *
   * Two-stage on purpose. The expanded bbox answers "could this pixel plausibly
   * be this flare, given how coarse the sensor is"; the polygon answers "is it
   * literally inside". A detection inside the polygon is masked outright. One
   * inside only the buffer is masked too, because at 3 km per pixel the centre
   * of a Meteosat detection sitting next to a refinery tells you nothing about
   * which of the two is burning.
   */
  lookup(point: Position, sensorClass: SensorClass): StaticHeatSource | null {
    for (const entry of this.entries) {
      const box = entry.boxes[sensorClass] ?? entry.boxes.unknown;
      if (!box || !bboxContains(box, point)) continue;
      if (pointInGeometry(point, entry.source.geometry)) return entry.source;
      // Inside the buffer but outside the polygon: still the same heat source
      // as far as a pixel this coarse can tell.
      return entry.source;
    }
    return null;
  }

  /** Exact containment, ignoring the sensor buffer. Used for map styling. */
  contains(point: Position): StaticHeatSource | null {
    for (const entry of this.entries) {
      const box = entry.boxes.landsat;
      if (box && !bboxContains(box, point)) continue;
      if (pointInGeometry(point, entry.source.geometry)) return entry.source;
    }
    return null;
  }
}

export function bufferMetersFor(sensorClass: SensorClass): number {
  return (
    cleaningPolicy.staticSourceBufferMeters[sensorClass] ??
    cleaningPolicy.staticSourceBufferMeters.unknown
  );
}
