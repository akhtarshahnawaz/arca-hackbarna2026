import { TtlCache, requestJson } from "../util/http.js";
import { compassPoint, type Position } from "../geo/index.js";
import type { IncidentWeather } from "../domain/types.js";

const cache = new TtlCache<IncidentWeather>(15 * 60_000);

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    wind_speed_10m?: number[];
    wind_gusts_10m?: number[];
    wind_direction_10m?: number[];
    relative_humidity_2m?: number[];
    temperature_2m?: number[];
  };
}

/**
 * Wind and humidity at the fire, from Open-Meteo.
 *
 * Free and keyless, which matters: an incident must not fail to brief because a
 * weather credential expired. DeepFire's simulation already returns the average
 * wind it used, but that is a single number for the whole run — the forecast
 * here is what tells a coordinator the wind is about to swing at four o'clock.
 */
export async function fetchWeather(
  position: Position,
  options: { hours?: number; at?: Date } = {},
): Promise<IncidentWeather | null> {
  const [lon, lat] = position;
  const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,temperature_2m",
    forecast_hours: String(options.hours ?? 12),
    timezone: "UTC",
    wind_speed_unit: "ms",
  });

  try {
    const payload = await requestJson<OpenMeteoResponse>(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      { timeoutMs: 8_000, retries: 1 },
    );

    const times = payload.hourly?.time ?? [];
    if (times.length === 0) return null;

    const target = (options.at ?? new Date()).getTime();
    let index = 0;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      if (!t) continue;
      const delta = Math.abs(Date.parse(`${t}Z`) - target);
      if (delta < best) {
        best = delta;
        index = i;
      }
    }

    const weather: IncidentWeather = {
      windSpeedMs: payload.hourly?.wind_speed_10m?.[index] ?? null,
      windGustMs: payload.hourly?.wind_gusts_10m?.[index] ?? null,
      windDirectionDeg: payload.hourly?.wind_direction_10m?.[index] ?? null,
      relativeHumidity: payload.hourly?.relative_humidity_2m?.[index] ?? null,
      temperatureC: payload.hourly?.temperature_2m?.[index] ?? null,
      observedAt: times[index] ? `${times[index]}Z` : new Date().toISOString(),
      source: "open-meteo",
    };

    cache.set(key, weather);
    return weather;
  } catch {
    // Weather is context, never a blocker. A missing forecast costs a sentence
    // in the briefing; a thrown error would cost the incident.
    return null;
  }
}

/** "gusting 12 m/s from the NW" — the phrase used in briefings and on the map. */
export function describeWind(weather: IncidentWeather | null): string {
  if (!weather || weather.windSpeedMs === null) return "Wind unknown.";
  const from = weather.windDirectionDeg !== null ? ` from the ${compassPoint(weather.windDirectionDeg)}` : "";
  const gust =
    weather.windGustMs !== null && weather.windGustMs > (weather.windSpeedMs ?? 0) + 2
      ? `, gusting ${weather.windGustMs.toFixed(0)} m/s`
      : "";
  const humidity =
    weather.relativeHumidity !== null ? ` Humidity ${Math.round(weather.relativeHumidity)}%.` : "";
  return `Wind ${weather.windSpeedMs.toFixed(0)} m/s${from}${gust}.${humidity}`;
}
