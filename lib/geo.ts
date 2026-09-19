import type { LonLat } from "@/lib/types";

export function pointInRing(point: LonLat, ring: LonLat[]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function ellipseRing(
  center: LonLat,
  rx: number,
  ry: number,
  rotationDeg: number,
  points = 36,
): LonLat[] {
  const rot = (rotationDeg * Math.PI) / 180;
  const [cx, cy] = center;
  const ring: LonLat[] = [];

  for (let i = 0; i < points; i += 1) {
    const t = (2 * Math.PI * i) / points;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    const xr = x * Math.cos(rot) - y * Math.sin(rot);
    const yr = x * Math.sin(rot) + y * Math.cos(rot);
    ring.push([cx + xr, cy + yr]);
  }

  ring.push(ring[0]);
  return ring;
}
