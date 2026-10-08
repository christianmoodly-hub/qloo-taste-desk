const cache = new Map();

export function normalizeQueries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 2 && item.length <= 180)
    .slice(0, 6);
}

async function lookup(query) {
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: { "user-agent": "TasteDesk/1.0 (qloo hackathon demo)", accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = await response.json();
  const coordinates = body?.features?.[0]?.geometry?.coordinates;
  const point = Array.isArray(coordinates) && coordinates.length >= 2
    ? { lng: Number(coordinates[0]), lat: Number(coordinates[1]) }
    : null;
  const usable = point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null;
  if (usable) cache.set(key, usable);
  return usable;
}

export function geocodePlaces(queries) {
  return Promise.all(normalizeQueries(queries).map((query) => lookup(query).catch(() => null)));
}

const reverseCache = new Map();

export async function reverseLocality(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (reverseCache.has(key)) return reverseCache.get(key);
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  const response = await fetch(url, {
    headers: { "user-agent": "TasteDesk/1.0 (qloo hackathon demo)", accept: "application/json" },
  });
  if (!response.ok) return "";
  const body = await response.json();
  const properties = body?.features?.[0]?.properties || {};
  const name = [properties.city, properties.town, properties.village, properties.county, properties.state, properties.name]
    .find((value) => typeof value === "string" && value.trim());
  const label = name ? name.trim() : "";
  if (label) reverseCache.set(key, label);
  return label;
}
