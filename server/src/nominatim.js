const cache = new Map();
const USER_AGENT = "TasteDesk/1.0 (qloo hackathon demo)";
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitTurn() {
  const wait = 1000 - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export function nearCityCenter(city) {
  const name = String(city || "").trim() || "the city";
  return `near ${name} center`;
}

export async function reverseNeighborhood(lat, lng, city) {
  const fallback = nearCityCenter(city);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fallback;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  await waitTurn();
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("zoom", "16");
  let label = fallback;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
    });
    if (response.ok) {
      const body = await response.json();
      const address = body?.address || {};
      const name = [
        address.neighbourhood,
        address.suburb,
        address.quarter,
        address.city_district,
        address.hamlet,
        address.village,
        address.town,
      ].find((value) => typeof value === "string" && value.trim());
      if (name) label = name.trim();
    }
  } catch {
    label = fallback;
  }
  cache.set(key, label);
  return label;
}
