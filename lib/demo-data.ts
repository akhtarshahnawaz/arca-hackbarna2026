import evacConfig from "@/config/evac-times.json";
import { ellipseRing } from "@/lib/geo";
import type { EvacConfig, HourPolygon, SiteInput } from "@/lib/types";

const config = evacConfig as EvacConfig;

export const DEMO_IGNITION = { lon: 1.82, lat: 41.72 };

export function demoPolygons(): HourPolygon[] {
  const polygons: HourPolygon[] = [];

  for (let member = 0; member < config.ensembleMembers; member += 1) {
    const scale = 0.78 + member * 0.035;
    const rotJitter = (member - 4.5) * 3.5;
    const shiftLon = ((member % 3) - 1) * 0.004;
    const shiftLat = (Math.floor(member / 3) - 1) * 0.003;

    for (let hour = 1; hour <= config.horizonHours; hour += 1) {
      const cx = DEMO_IGNITION.lon + 0.012 * hour + shiftLon;
      const cy = DEMO_IGNITION.lat + 0.009 * hour + shiftLat;
      polygons.push({
        hour,
        member,
        ring: ellipseRing(
          [cx, cy],
          (0.005 + 0.0065 * hour) * scale,
          (0.0035 + 0.0045 * hour) * scale,
          38 + rotJitter,
        ),
      });
    }
  }

  return polygons;
}

export function demoSites(): SiteInput[] {
  return [
    {
      id: "r-care-041",
      code: "R-CARE-041",
      kind: "care_home",
      municipality: "Navàs",
      lon: 1.856,
      lat: 41.747,
      animals: [],
      hasOwnTransport: false,
      confirmedAt: null,
      capacityUpdatedAt: null,
      source: "osm",
      shelterHint: "Hospital Sant Joan de Déu Manresa — people only. Animals stay at POL-REC-08.",
      notes: "48 residents. No animals on site. Long load time: walkers, oxygen, night staff.",
    },
    {
      id: "rega-b-1842",
      code: "REGA-B-1842",
      kind: "farm",
      municipality: "Sant Fruitós de Bages",
      lon: 1.86,
      lat: 41.75,
      animals: [{ species: "sheep", registeredCapacity: 400, confirmedCount: 312 }],
      hasOwnTransport: false,
      confirmedAt: "2026-09-19T06:14:00.000Z",
      capacityUpdatedAt: "2026-07-12T00:00:00.000Z",
      source: "registry",
      shelterHint: "POL-REC-08 Recinte Firal Manresa — livestock pens confirmed this morning.",
      notes: "The flock is the rent. Registry still lists 400; farmer confirmed 312 today.",
    },
    {
      id: "hh-pet-07",
      code: "HH-PET-07",
      kind: "household",
      municipality: "Castellnou de Bages",
      lon: 1.844,
      lat: 41.738,
      animals: [{ species: "dogs", registeredCapacity: 2, confirmedCount: 2 }],
      hasOwnTransport: false,
      confirmedAt: "2026-09-19T07:02:00.000Z",
      capacityUpdatedAt: null,
      source: "resident",
      shelterHint: "PAV-ESP-03 Pavelló Nou — accepts dogs if crated or leashed.",
      notes: "Two dogs, no car. People do not leave if the dogs cannot come.",
    },
    {
      id: "rega-b-0911",
      code: "REGA-B-0911",
      kind: "farm",
      municipality: "Sallent",
      lon: 1.889,
      lat: 41.772,
      animals: [{ species: "goats", registeredCapacity: 86, confirmedCount: null }],
      hasOwnTransport: true,
      confirmedAt: null,
      capacityUpdatedAt: "2026-07-12T00:00:00.000Z",
      source: "registry",
      shelterHint: "POL-REC-08 Recinte Firal Manresa — ask if a trailer is already loaded.",
      notes: "Capacity on file only. Ask how many goats are on the hill today.",
    },
    {
      id: "hh-pet-12",
      code: "HH-PET-12",
      kind: "household",
      municipality: "Santpedor",
      lon: 1.904,
      lat: 41.784,
      animals: [
        { species: "dogs", registeredCapacity: 1, confirmedCount: 1 },
        { species: "cats", registeredCapacity: 2, confirmedCount: 2 },
      ],
      hasOwnTransport: true,
      confirmedAt: "2026-09-19T05:40:00.000Z",
      capacityUpdatedAt: null,
      source: "resident",
      shelterHint: "PAV-ESP-03 Pavelló Nou — dogs and cats accepted.",
      notes: "Own car. Still needs a place that takes the animals.",
    },
    {
      id: "hh-pet-03",
      code: "HH-PET-03",
      kind: "household",
      municipality: "Avinyó",
      lon: 1.87,
      lat: 41.758,
      animals: [{ species: "horses", registeredCapacity: 2, confirmedCount: null }],
      hasOwnTransport: false,
      confirmedAt: null,
      capacityUpdatedAt: null,
      source: "resident",
      shelterHint: "POL-REC-08 Recinte Firal Manresa — two boxes if a trailer can be sent.",
      notes: "Two horses, no trailer on site. Confirm they are still in the paddock.",
    },
    {
      id: "r-care-watch",
      code: "R-CARE-WATCH",
      kind: "care_home",
      municipality: "Cardona",
      lon: 1.678,
      lat: 41.914,
      animals: [],
      hasOwnTransport: false,
      confirmedAt: null,
      capacityUpdatedAt: null,
      source: "demo",
      shelterHint: "Outside this briefing's likely/possible set. Do not rank it first.",
      notes: "Watch only. A 1/10 care home must not jump the ranked list even if spare time looks worse.",
    },
  ];
}

export function siteKindLabel(kind: SiteInput["kind"]): string {
  if (kind === "care_home") return "Care home";
  if (kind === "hospital") return "Hospital";
  if (kind === "school") return "School";
  if (kind === "farm") return "Farm";
  return "Household";
}
