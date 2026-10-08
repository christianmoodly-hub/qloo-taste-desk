const SEARCH_TYPES = new Set([
  "artist",
  "book",
  "brand",
  "movie",
  "person",
  "place",
  "podcast",
  "tv_show",
  "videogame",
  "locality",
  "actor",
  "album",
  "author",
  "director",
]);

const CITY_COUNTRY = {
  johannesburg: "South Africa",
  sandton: "South Africa",
  "cape town": "South Africa",
  pretoria: "South Africa",
  durban: "South Africa",
  lisbon: "Portugal",
  lisboa: "Portugal",
  porto: "Portugal",
  tokyo: "Japan",
  brooklyn: "United States",
  "new york": "United States",
  paris: "France",
  london: "United Kingdom",
  berlin: "Germany",
};

const CLUSTER_RADIUS_KM = 120;
const CLUSTER_LIMIT = 4;

export function countryForCity(city) {
  const text = String(city || "").trim();
  if (!text) return "";
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 1];
  return CITY_COUNTRY[text.toLowerCase()] || "";
}

export function searchEntityType(type) {
  const tail = String(type || "").split(":").filter(Boolean).pop()?.toLowerCase() || "";
  return SEARCH_TYPES.has(tail) ? tail : "";
}

function distanceKm(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat = toRad(to.lat - from.lat);
  const lng = toRad(to.lng - from.lng);
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function heatmapPoints(result, source) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const points = [];
  for (const row of rows) {
    const lat = Number(row?.location?.latitude);
    const lng = Number(row?.location?.longitude);
    const affinity = Number(row?.query?.affinity);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(affinity)) continue;
    points.push({
      lat,
      lng,
      affinity,
      source: String(source || ""),
    });
  }
  return points;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clusterTastePoints(points, { radiusKm = CLUSTER_RADIUS_KM, limit = CLUSTER_LIMIT } = {}) {
  const clusters = [];
  const ordered = [...points].sort((left, right) => right.affinity - left.affinity);
  for (const point of ordered) {
    let nearest = null;
    let nearestKm = radiusKm;
    for (const cluster of clusters) {
      const km = distanceKm(point, cluster);
      if (km <= nearestKm) {
        nearest = cluster;
        nearestKm = km;
      }
    }
    if (!nearest) {
      clusters.push({
        lat: point.lat,
        lng: point.lng,
        weight: point.affinity,
        count: 1,
        sources: point.source ? [point.source] : [],
      });
      continue;
    }
    const nextWeight = nearest.weight + point.affinity;
    nearest.lat = (nearest.lat * nearest.weight + point.lat * point.affinity) / nextWeight;
    nearest.lng = (nearest.lng * nearest.weight + point.lng * point.affinity) / nextWeight;
    nearest.weight = nextWeight;
    nearest.count += 1;
    if (point.source && !nearest.sources.includes(point.source)) nearest.sources.push(point.source);
  }
  return clusters
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit)
    .map((cluster) => ({
      latitude: round(cluster.lat, 5),
      longitude: round(cluster.lng, 5),
      weight: round(cluster.weight, 4),
      count: cluster.count,
      sources: cluster.sources,
    }));
}

function areaName(cluster) {
  if (cluster.label) return cluster.label;
  const lat = Math.abs(cluster.latitude).toFixed(1);
  const lng = Math.abs(cluster.longitude).toFixed(1);
  const north = cluster.latitude >= 0 ? "N" : "S";
  const east = cluster.longitude >= 0 ? "E" : "W";
  return `${lat}°${north}, ${lng}°${east}`;
}

export function tasteMapSummary(clusters, country) {
  if (!clusters?.length || !country) return "";
  const areas = clusters.slice(0, 2).map(areaName);
  if (areas.length === 1) {
    return `The strongest aggregate pattern in ${country} sits around ${areas[0]}.`;
  }
  return `The strongest aggregate pattern in ${country} sits around ${areas[0]}, then ${areas[1]}.`;
}

export async function buildTasteMap({ resolved, city, execute, labelPlace }) {
  const country = countryForCity(city);
  const items = Array.isArray(resolved) ? resolved.filter(Boolean) : [];
  const trace = [];
  if (!country) {
    return { country: "", summary: "", clusters: [], trace };
  }

  const points = [];
  for (const item of items) {
    if (item.kind !== "entity" || !item.entity_id) {
      trace.push(`Skipped ${item.input} for the taste map`);
      continue;
    }
    const input = { entity: item.entity_id, within: country, limit: 5 };
    const entityType = searchEntityType(item.type);
    if (entityType) input.entity_type = entityType;
    let response;
    try {
      response = await execute({ operation: "where_popular", input });
    } catch {
      trace.push(`Skipped ${item.input} for the taste map`);
      continue;
    }
    const result = response?.body?.result;
    const usable = response?.body?.ok === true && result?.status === "ok";
    const found = usable ? heatmapPoints(result, item.input || item.name) : [];
    if (!usable || found.length === 0) {
      trace.push(`Skipped ${item.input} for the taste map`);
      continue;
    }
    trace.push(`Called where_popular for ${item.input} within ${country}`);
    points.push(...found);
  }

  const clusters = clusterTastePoints(points);
  if (labelPlace) {
    for (const cluster of clusters) {
      try {
        const label = await labelPlace(cluster.latitude, cluster.longitude);
        if (typeof label === "string" && label.trim()) cluster.label = label.trim();
      } catch {
        // A missing place name still leaves the weighted cluster.
      }
    }
  }

  return {
    country,
    summary: tasteMapSummary(clusters, country),
    clusters,
    trace,
  };
}
