import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * What kind of place this is, as a mark you can read at a glance.
 *
 * The map already uses colour for the instruction — evacuate, shelter, prepare
 * — and colour can only carry one meaning at a time without becoming a puzzle.
 * So the kind of place is carried by shape instead: a white pictogram drawn on
 * top of the coloured disc.
 *
 * Every glyph is a silhouette rather than a drawing. At eighteen pixels on a
 * wall display, detail is noise; what survives is the outline. A cross, a bed,
 * a book, a tent, a house, a fence, a factory, a bolt. Nothing here needs a
 * legend to guess at, though there is one anyway.
 */

export type SiteIconKey =
  | "hospital"
  | "care"
  | "school"
  | "campsite"
  | "lodging"
  | "housing"
  | "livestock"
  | "industry"
  | "utility"
  | "responder"
  | "place";

export const SITE_ICON_LABELS: Record<SiteIconKey, string> = {
  hospital: "Hospital or clinic",
  care: "Care home",
  school: "School or nursery",
  campsite: "Campsite",
  lodging: "Hotel or lodging",
  housing: "Housing",
  livestock: "Livestock",
  industry: "Industry",
  utility: "Utility",
  responder: "Emergency service",
  place: "Other site",
};

/** Drawn in the legend, in the order a coordinator cares about them. */
export const LEGEND_ICONS: SiteIconKey[] = [
  "hospital",
  "care",
  "school",
  "campsite",
  "housing",
  "livestock",
  "industry",
  "utility",
];

/**
 * Category and subcategory to a glyph.
 *
 * Subcategory is checked first because Talaia's categories are broad — a
 * campsite and a marina are both `tourism`, and one of them sleeps four hundred
 * people in tents.
 */
export function iconKeyFor(input: {
  category?: string | null;
  subcategory?: string | null;
  responseAsset?: boolean;
}): SiteIconKey {
  const sub = (input.subcategory ?? "").toLowerCase();
  const cat = (input.category ?? "").toLowerCase();

  if (/fire_station|police|civil_protection|ambulance/.test(sub)) return "responder";
  if (/hospital|clinic|primary_care|health/.test(sub)) return "hospital";
  if (/care_home|nursing|residencia|assisted|elderly|disabled/.test(sub)) return "care";
  if (/school|nursery|kindergarten|college|university|institut|educat/.test(sub)) return "school";
  if (/campsite|camping|caravan/.test(sub)) return "campsite";
  if (/hotel|hostel|guest|marina|apartment_tourist/.test(sub)) return "lodging";
  if (/housing|dwelling|residential|urbanitzacio|apartment/.test(sub)) return "housing";
  if (/farm|livestock|stable|barn|apiary|kennel/.test(sub)) return "livestock";
  if (/substation|water_treatment|power|telecom|mast|pump|reservoir/.test(sub)) return "utility";
  if (/fuel|chemical|industrial|factory|plant|quarry|warehouse/.test(sub)) return "industry";

  if (cat === "healthcare") return "hospital";
  if (cat === "social_care") return "care";
  if (cat === "education") return "school";
  if (cat === "tourism") return "lodging";
  if (cat === "residential") return "housing";
  if (cat === "livestock") return "livestock";
  if (cat === "utilities") return "utility";
  if (cat === "industry") return "industry";
  if (cat === "emergency") return "responder";

  return input.responseAsset ? "responder" : "place";
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

type Draw = (ctx: CanvasRenderingContext2D, s: number) => void;

/**
 * Each glyph draws into a unit-ish box of side `s`, centred.
 *
 * Strokes rather than fills wherever possible: a stroked outline keeps its
 * shape when the disc underneath is bright, where a solid fill would flatten
 * into it.
 */
const DRAW: Record<SiteIconKey, Draw> = {
  hospital: (c, s) => {
    const arm = s * 0.3;
    const thick = s * 0.16;
    c.fillRect(-thick / 2, -arm, thick, arm * 2);
    c.fillRect(-arm, -thick / 2, arm * 2, thick);
  },

  care: (c, s) => {
    // A bed, seen from the side: headboard, mattress, one leg each end.
    const w = s * 0.62;
    const h = s * 0.2;
    c.lineWidth = s * 0.11;
    c.beginPath();
    c.moveTo(-w / 2, -h);
    c.lineTo(-w / 2, h);
    c.moveTo(-w / 2, 0);
    c.lineTo(w / 2, 0);
    c.lineTo(w / 2, h);
    c.stroke();
    c.fillRect(-w / 2, -h * 0.9, w * 0.42, h * 0.72);
  },

  school: (c, s) => {
    // An open book: two leaves meeting at a spine.
    const w = s * 0.33;
    const h = s * 0.26;
    c.lineWidth = s * 0.1;
    c.beginPath();
    c.moveTo(0, -h * 0.7);
    c.lineTo(0, h);
    c.moveTo(0, -h * 0.7);
    c.quadraticCurveTo(-w * 0.6, -h * 1.15, -w, -h * 0.55);
    c.lineTo(-w, h * 0.5);
    c.quadraticCurveTo(-w * 0.6, h * 0.15, 0, h);
    c.moveTo(0, -h * 0.7);
    c.quadraticCurveTo(w * 0.6, -h * 1.15, w, -h * 0.55);
    c.lineTo(w, h * 0.5);
    c.quadraticCurveTo(w * 0.6, h * 0.15, 0, h);
    c.stroke();
  },

  campsite: (c, s) => {
    // A tent: two poles to a peak, with a ground line.
    const w = s * 0.34;
    const h = s * 0.3;
    c.lineWidth = s * 0.11;
    c.beginPath();
    c.moveTo(-w, h);
    c.lineTo(0, -h);
    c.lineTo(w, h);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(0, -h);
    c.lineTo(0, h);
    c.stroke();
  },

  lodging: (c, s) => {
    // A bed with a pillow and a raised foot — distinct from `care` by the
    // pillow sitting inside rather than a tall headboard.
    const w = s * 0.62;
    const h = s * 0.18;
    c.lineWidth = s * 0.11;
    c.beginPath();
    c.moveTo(-w / 2, h * 1.4);
    c.lineTo(-w / 2, -h * 0.4);
    c.quadraticCurveTo(-w / 2, -h * 1.1, -w * 0.15, -h * 1.1);
    c.lineTo(w * 0.36, -h * 1.1);
    c.quadraticCurveTo(w / 2, -h * 1.1, w / 2, -h * 0.3);
    c.lineTo(w / 2, h * 1.4);
    c.moveTo(-w / 2, h * 0.3);
    c.lineTo(w / 2, h * 0.3);
    c.stroke();
  },

  housing: (c, s) => {
    // A house: pitched roof over a body.
    const w = s * 0.32;
    const h = s * 0.28;
    c.lineWidth = s * 0.1;
    c.beginPath();
    c.moveTo(-w, 0);
    c.lineTo(0, -h);
    c.lineTo(w, 0);
    c.stroke();
    c.beginPath();
    c.moveTo(-w * 0.74, 0);
    c.lineTo(-w * 0.74, h);
    c.lineTo(w * 0.74, h);
    c.lineTo(w * 0.74, 0);
    c.stroke();
  },

  livestock: (c, s) => {
    // A field fence: three posts, two rails. Reads as rural at any size, which
    // an animal silhouette does not.
    const w = s * 0.36;
    const h = s * 0.26;
    c.lineWidth = s * 0.095;
    c.beginPath();
    for (const x of [-w, 0, w]) {
      c.moveTo(x, -h);
      c.lineTo(x, h);
    }
    c.moveTo(-w * 1.25, -h * 0.35);
    c.lineTo(w * 1.25, -h * 0.35);
    c.moveTo(-w * 1.25, h * 0.4);
    c.lineTo(w * 1.25, h * 0.4);
    c.stroke();
  },

  industry: (c, s) => {
    // A works: a stepped roofline with a chimney.
    const w = s * 0.36;
    const h = s * 0.26;
    c.lineWidth = s * 0.095;
    c.beginPath();
    c.moveTo(-w, h);
    c.lineTo(-w, -h * 0.1);
    c.lineTo(-w * 0.1, h * 0.35);
    c.lineTo(-w * 0.1, -h * 0.1);
    c.lineTo(w * 0.8, h * 0.35);
    c.lineTo(w * 0.8, h);
    c.closePath();
    c.stroke();
    c.beginPath();
    c.moveTo(w * 0.42, -h * 0.15);
    c.lineTo(w * 0.42, -h);
    c.lineTo(w * 0.82, -h);
    c.lineTo(w * 0.82, h * 0.1);
    c.stroke();
  },

  utility: (c, s) => {
    // A bolt.
    const w = s * 0.2;
    const h = s * 0.32;
    c.beginPath();
    c.moveTo(w * 0.5, -h);
    c.lineTo(-w, h * 0.12);
    c.lineTo(-w * 0.05, h * 0.12);
    c.lineTo(-w * 0.45, h);
    c.lineTo(w, -h * 0.2);
    c.lineTo(w * 0.1, -h * 0.2);
    c.closePath();
    c.fill();
  },

  responder: (c, s) => {
    // A shield.
    const w = s * 0.28;
    const h = s * 0.3;
    c.lineWidth = s * 0.1;
    c.beginPath();
    c.moveTo(0, -h);
    c.lineTo(w, -h * 0.55);
    c.lineTo(w, h * 0.1);
    c.quadraticCurveTo(w, h * 0.72, 0, h);
    c.quadraticCurveTo(-w, h * 0.72, -w, h * 0.1);
    c.lineTo(-w, -h * 0.55);
    c.closePath();
    c.stroke();
  },

  place: (c, s) => {
    c.beginPath();
    c.arc(0, 0, s * 0.13, 0, Math.PI * 2);
    c.fill();
  },
};

/** Name the map knows a glyph by. */
export function iconImageId(key: SiteIconKey): string {
  return `arca-site-${key}`;
}

const SIZE = 22;
const RATIO = 2;

function render(key: SiteIconKey, colour: string): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * RATIO;
  canvas.height = SIZE * RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(RATIO, RATIO);
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  DRAW[key](ctx, SIZE);

  return ctx.getImageData(0, 0, SIZE * RATIO, SIZE * RATIO);
}

/**
 * Register every glyph with the map.
 *
 * Plain raster images rather than SDF: SDF would allow `icon-color` to tint a
 * single set, but generating a distance field in the browser for eleven glyphs
 * costs more than drawing eleven white ones. White works on every action colour
 * in the palette, which is the only tint needed.
 *
 * Safe to call more than once; MapLibre throws on a duplicate image id.
 */
export function registerSiteIcons(map: MapLibreMap, colour = "#ffffff"): void {
  for (const key of Object.keys(DRAW) as SiteIconKey[]) {
    const id = iconImageId(key);
    if (map.hasImage(id)) continue;
    const image = render(key, colour);
    if (!image) continue;
    map.addImage(id, image, { pixelRatio: RATIO });
  }
}

/** The same glyph as an inline SVG-free data URL, for the legend. */
export function iconDataUrl(key: SiteIconKey, colour: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * RATIO;
  canvas.height = SIZE * RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(RATIO, RATIO);
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  DRAW[key](ctx, SIZE);
  return canvas.toDataURL();
}
