import { nearCityCenter } from "./nominatim.js";

const SEARCH_TYPES = new Set([
  "artist", "book", "brand", "movie", "person", "place", "podcast",
  "tv_show", "videogame", "locality", "actor", "album", "author", "director",
]);

const HEATMAP_LIMIT = 20;
const CELL_KM = 1.5;
const CLUSTER_LIMIT = 2;
const OVERLAP_KM = 2;

export const FAVORITE_COLORS = ["#2c241c", "#c45c26", "#3d6b8c", "#5e6b55", "#7a4e6d"];

export function cityScope(city) {
  const text = String(city || "").trim();
  if (!text) return "";
  return text.split(",")[0].trim();
}

export function searchEntityType(type) {
  const tail = String(type || "").split(":").filter(Boolean).pop()?.toLowerCase() || "";
  return SEARCH_TYPES.has(tail) ? tail : "";
}

export function distanceKm(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat = toRad(to.latitude - from.latitude);
  const lng = toRad(to.longitude - from.longitude);
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function heatmapPoints(result) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const points = [];
  for (const row of rows) {
    const lat = Number(row?.location?.latitude);
    const lng = Number(row?.location?.longitude);
    const affinity = Number(row?.query?.affinity);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(affinity)) continue;
    points.push({ lat, lng, affinity });
  }
  return points;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clusterFavoritePoints(points, { cellKm = CELL_KM, limit = CLUSTER_LIMIT } = {}) {
  if (!points.length) return [];
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const dLat = cellKm / 111.32;
  const dLng = cellKm / (111.32 * Math.max(0.2, Math.cos(meanLat * Math.PI / 180)));
  const cells = new Map();
  for (const point of points) {
    const key = `${Math.floor(point.lat / dLat)}:${Math.floor(point.lng / dLng)}`;
    const cell = cells.get(key) || { weight: 0, count: 0, latSum: 0, lngSum: 0 };
    cell.weight += point.affinity;
    cell.count += 1;
    cell.latSum += point.lat * point.affinity;
    cell.lngSum += point.lng * point.affinity;
    cells.set(key, cell);
  }
  return [...cells.values()]
    .sort((left, right) => right.weight - left.weight)
    .slice(0, limit)
    .map((cell) => ({
      latitude: round(cell.latSum / cell.weight, 5),
      longitude: round(cell.lngSum / cell.weight, 5),
      weight: round(cell.weight, 4),
      count: cell.count,
    }));
}

export function findOverlaps(favorites, radiusKm = OVERLAP_KM) {
  const overlaps = [];
  const seen = new Set();
  for (let left = 0; left < favorites.length; left += 1) {
    for (let right = left + 1; right < favorites.length; right += 1) {
      const pair = `${favorites[left].name}|${favorites[right].name}`;
      if (seen.has(pair)) continue;
      for (const a of favorites[left].clusters) {
        for (const b of favorites[right].clusters) {
          if (distanceKm(a, b) > radiusKm) continue;
          seen.add(pair);
          overlaps.push({
            favorites: [favorites[left].name, favorites[right].name],
            label: a.weight >= b.weight ? a.label : b.label,
          });
          break;
        }
        if (seen.has(pair)) break;
      }
    }
  }
  return overlaps;
}

export function tasteMapSummary(favorites, overlaps) {
  const named = (favorites || []).filter((favorite) => favorite.clusters?.[0]?.label);
  if (named.length === 0) return "";
  const overlap = (overlaps || []).find((item) => item.label && item.favorites?.length === 2);
  if (overlap) {
    return `${overlap.favorites[0]} and ${overlap.favorites[1]} fans both point toward ${overlap.label}.`;
  }
  if (named.length === 1) {
    return `${named[0].name} fans point toward ${named[0].clusters[0].label}.`;
  }
  const first = named[0];
  const second = named[1];
  return `${first.name} fans point toward ${first.clusters[0].label}, while ${second.name} fans point toward ${second.clusters[0].label}.`;
}

export async function buildTasteMap({ resolved, city, execute, labelPlace }) {
  const scope = cityScope(city);
  const items = Array.isArray(resolved) ? resolved.filter(Boolean) : [];
  const trace = [];
  if (!scope) return { city: "", summary: "", favorites: [], overlaps: [], trace };

  const grouped = [];
  for (const item of items) {
    if (item.kind !== "entity" || !item.entity_id) {
      trace.push(`Skipped ${item.input} for the taste map`);
      continue;
    }
    const input = { entity: item.entity_id, within: scope, limit: HEATMAP_LIMIT };
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
    if (result?.status === "empty") {
      trace.push(`No heatmap for ${item.input} in ${scope}`);
      continue;
    }
    const points = result?.status === "ok" ? heatmapPoints(result) : [];
    if (response?.body?.ok !== true || points.length === 0) {
      trace.push(result?.status === "ok"
        ? `No heatmap for ${item.input} in ${scope}`
        : `Skipped ${item.input} for the taste map`);
      continue;
    }
    trace.push(`Called where_popular for ${item.input} within ${scope}`);
    grouped.push({
      name: item.input || item.name,
      clusters: clusterFavoritePoints(points),
    });
  }

  const favorites = [];
  for (const group of grouped) {
    if (group.clusters.length === 0) continue;
    const favorite = {
      name: group.name,
      color: FAVORITE_COLORS[favorites.length % FAVORITE_COLORS.length],
      clusters: group.clusters,
    };
    for (const cluster of favorite.clusters) {
      let label = "";
      if (labelPlace) {
        try {
          label = await labelPlace(cluster.latitude, cluster.longitude, scope);
        } catch {
          label = "";
        }
      }
      cluster.label = typeof label === "string" && label.trim()
        ? label.trim()
        : nearCityCenter(scope);
    }
    favorites.push(favorite);
  }

  const overlaps = findOverlaps(favorites);
  return {
    city: scope,
    summary: tasteMapSummary(favorites, overlaps),
    favorites,
    overlaps,
    trace,
  };
}
