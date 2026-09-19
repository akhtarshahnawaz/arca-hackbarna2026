/**
 * Checks the NASA FIRMS cross-check feed the console ranks against.
 *
 * Run: npm run firms:ping
 * A MAP_KEY is free and instant: https://firms.modaps.eosdis.nasa.gov/api/map_key/
 */

const BBOX = "0.15,40.52,3.33,42.86";

async function main() {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) {
    console.error("FIRMS_MAP_KEY is not set in .env.local. Cross-check stays off.");
    process.exit(1);
  }

  const sensors = (process.env.FIRMS_SENSORS ?? "VIIRS_NOAA20_NRT,VIIRS_SNPP_NRT")
    .split(",")
    .map((sensor) => sensor.trim())
    .filter(Boolean);
  const days = process.env.FIRMS_DAY_RANGE?.trim() || "1";

  for (const sensor of sensors) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${sensor}/${BBOX}/${days}`;
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();

    if (!res.ok || body.startsWith("Invalid")) {
      console.error(`${sensor}: HTTP ${res.status} — ${body.trim().slice(0, 120)}`);
      continue;
    }

    const rows = body.trim().split("\n").length - 1;
    console.log(`${sensor}: ${rows} detection${rows === 1 ? "" : "s"} in the Catalonia box, last ${days} day(s).`);
    if (rows > 0) console.log(`  first row: ${body.trim().split("\n")[1]}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
