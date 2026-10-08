import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/src/app.js";
import { loadEnv, redactSecrets } from "../server/src/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = path.join(root, "docs", "samples");

const AMELIE = "B7A0731F-EC92-496A-9C40-47D9770489B6";
const RADIOHEAD = "70CAE5BF-2F4C-445C-A3E5-4EDACFC3591C";
const RAMEN_TAG = "urn:tag:cuisine:qloo:ramen";

const calls = [
  ["find_tags", { query: "sneakers", limit: 5 }],
  ["describe", { entity: "Nike", type: "brand" }],
  ["recommend", { target_type: "place", signals: ["Radiohead", "ramen"], filter_location: "Lisbon", limit: 5 }],
  ["entity_tags", { entities: [AMELIE, RADIOHEAD], limit: 8 }, "entity_tags.json"],
  ["rank", {
    options: [
      "Les Créatifs Restaurant",
      "86 Public Fourways",
      "Marble",
      "The Grillhouse Rosebank",
      "DW Eleven-13",
      "Cube Tasting Kitchen",
    ],
    option_type: "place",
    signals: [AMELIE, RADIOHEAD],
    include_tags: [RAMEN_TAG],
  }, "rank.json"],
  ["where_popular", { entity: "ramen", within: "South Africa", limit: 5 }, "where_popular-ramen-south-africa.json"],
  ["where_popular", { entity: "ramen", within: "Portugal", limit: 5 }, "where_popular-ramen-portugal.json"],
  ["where_popular", { entity: "Radiohead", entity_type: "artist", within: "South Africa", limit: 5 }, "where_popular-radiohead-south-africa.json"],
  ["where_popular", { entity: "Radiohead", entity_type: "artist", within: "Portugal", limit: 5 }, "where_popular-radiohead-portugal.json"],
  ["entity_tags", { entities: [AMELIE], entity_type: "movie", limit: 8 }, "entity_tags-amelie-movie.json"],
  ["entity_tags", { entities: [RADIOHEAD], entity_type: "artist", limit: 8 }, "entity_tags-radiohead-artist.json"],
  ["where_popular", { entity: AMELIE, entity_type: "movie", within: "Portugal", limit: 5 }, "where_popular-amelie-portugal.json"],
  ["where_popular", { entity: RADIOHEAD, entity_type: "artist", within: "Lisbon", limit: 5 }, "where_popular-radiohead-lisbon.json"],
  ["where_popular", { entity: AMELIE, entity_type: "movie", within: "Lisbon", limit: 5 }, "where_popular-amelie-lisbon.json"],
  ["where_popular", { entity: RADIOHEAD, entity_type: "artist", within: "Johannesburg", limit: 5 }, "where_popular-radiohead-johannesburg.json"],
  ["where_popular", { entity: AMELIE, entity_type: "movie", within: "Johannesburg", limit: 5 }, "where_popular-amelie-johannesburg.json"],
  ["where_popular", { entity: RADIOHEAD, entity_type: "artist", within: "Porto", limit: 5 }, "where_popular-radiohead-porto.json"],
  ["where_popular", { entity: AMELIE, entity_type: "movie", within: "Porto", limit: 5 }, "where_popular-amelie-porto.json"],
];

const restaurants = [
  ["describe-les-creatifs-johannesburg.json", "Les Créatifs Restaurant Johannesburg"],
  ["describe-86-public-johannesburg.json", "86 Public Fourways Johannesburg"],
  ["describe-marble-johannesburg.json", "Marble Johannesburg"],
  ["describe-grillhouse-johannesburg.json", "The Grillhouse Rosebank Johannesburg"],
  ["describe-dw-eleven-johannesburg.json", "DW Eleven-13 Johannesburg"],
  ["describe-cube-johannesburg.json", "Cube Tasting Kitchen Johannesburg"],
  ["describe-les-creatifs-bryanston.json", "Les Créatifs Restaurant Bryanston"],
  ["describe-grillhouse-johannesburg-name.json", "The Grillhouse Johannesburg"],
  ["describe-dw-eleven-dunkeld.json", "DW Eleven - 13 Johannesburg"],
  ["describe-cube-parktown.json", "Cube Tasting Kitchen Parktown North"],
];

const RANK_RESOLVED = "rank-resolved.json";
const RANK_PLACES = "rank-places.json";

function samplePath(operation, fileName) {
  return path.join(samplesDir, fileName ?? `${operation}.json`);
}

function assertNoSecrets(operation, text) {
  if (
    text.includes(process.env.QLOO_API_KEY || "___no_qloo_key___")
    || text.includes(process.env.GEMINI_API_KEY || "___no_gemini_key___")
    || text.includes(process.env.GROQ_API_KEY || "___no_groq_key___")
  ) {
    throw new Error(`${operation} sample still contains a credential`);
  }
}

function summarize(fileName, status, body) {
  const result = body.result && typeof body.result === "object" ? body.result : {};
  const resultStatus = result.status;
  const lines = [
    `${fileName}: HTTP ${status} ok=${body.ok === true} status=${resultStatus ?? "-"} count=${result.result_count ?? "-"}`,
  ];
  if (resultStatus === "needs_input" || resultStatus === "empty") {
    const issues = Array.isArray(result.resolution?.issues) ? result.resolution.issues : [];
    const unresolved = issues.map((issue) => issue?.input).filter(Boolean);
    lines.push(`  unresolved: ${unresolved.length > 0 ? unresolved.join(", ") : "(none)"}`);
  } else {
    const keys = Object.keys(result);
    lines.push(`  result keys: ${keys.length > 0 ? keys.join(", ") : "(none)"}`);
    const first = Array.isArray(result.results) ? result.results[0] : undefined;
    if (first && typeof first === "object") {
      lines.push(`  result[0] keys: ${Object.keys(first).join(", ")}`);
    }
  }
  console.log(lines.join("\n"));
}

function resolvedPlace(body) {
  const result = body?.result;
  if (result?.status !== "ok") return null;
  const entity = result.interpretation?.entity;
  const entityId = entity?.entityId ?? result.results?.[0]?.entity_id;
  if (typeof entityId !== "string" || entityId.length === 0) return null;
  return {
    entityId,
    name: entity?.name ?? result.results?.[0]?.name ?? entityId,
  };
}

loadEnv();

const pending = calls.filter(([operation, , fileName]) => !existsSync(samplePath(operation, fileName)));
const describePending = restaurants.filter(([fileName]) => !existsSync(path.join(samplesDir, fileName)));
const rankPending = !existsSync(path.join(samplesDir, RANK_RESOLVED));
const rankPlacesPending = !existsSync(path.join(samplesDir, RANK_PLACES));

for (const [operation, , fileName] of calls) {
  if (existsSync(samplePath(operation, fileName))) {
    console.log(`skip ${fileName ?? `${operation}.json`}`);
  }
}
for (const [fileName] of restaurants) {
  if (existsSync(path.join(samplesDir, fileName))) console.log(`skip ${fileName}`);
}
if (!rankPending) console.log(`skip ${RANK_RESOLVED}`);
if (!rankPlacesPending) console.log(`skip ${RANK_PLACES}`);

if (pending.length === 0 && describePending.length === 0 && !rankPending && !rankPlacesPending) {
  console.log("no new probe calls");
} else {
  const server = await new Promise((resolve) => {
    const listening = createApp().listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function exec(operation, input, fileName) {
    const response = await fetch(`${base}/api/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
    const body = await response.json();
    const text = redactSecrets(JSON.stringify(body, null, 2));
    assertNoSecrets(operation, text);
    const savedAs = fileName ?? `${operation}.json`;
    await writeFile(path.join(samplesDir, savedAs), `${text}\n`);
    summarize(savedAs, response.status, body);
    return body;
  }

  try {
    await mkdir(samplesDir, { recursive: true });
    for (const [operation, input, fileName] of pending) {
      await exec(operation, input, fileName);
    }

    const resolved = [];
    for (const [fileName, query] of restaurants) {
      const file = path.join(samplesDir, fileName);
      const body = existsSync(file)
        ? JSON.parse(await readFile(file, "utf8"))
        : await exec("describe", { entity: query, type: "place" }, fileName);
      const place = resolvedPlace(body);
      if (place) {
        resolved.push({ query, ...place });
        console.log(`resolved ${query} -> ${place.name} ${place.entityId}`);
      } else {
        console.log(`unresolved ${query}`);
      }
    }

    if (rankPending) {
      if (resolved.length === 0) {
        console.log("rank skipped: no restaurant describe call resolved");
      } else {
        await exec("rank", {
          options: resolved.map((place) => place.entityId),
          option_type: "place",
          signals: [AMELIE, RADIOHEAD],
          include_tags: [RAMEN_TAG],
        }, RANK_RESOLVED);
      }
    }

    if (rankPlacesPending) {
      const places = resolved.filter((place) => place.entityId);
      const unique = [...new Map(places.map((place) => [place.entityId, place])).values()];
      if (unique.length === 0) {
        console.log("rank-places skipped: no restaurant describe call resolved");
      } else {
        console.log(`ranking ${unique.map((place) => place.name).join(", ")}`);
        await exec("rank", {
          options: unique.map((place) => place.entityId),
          option_type: "place",
          signals: [AMELIE, RADIOHEAD],
        }, RANK_PLACES);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function distanceKm(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat = toRad(to.lat - from.lat);
  const lng = toRad(to.lng - from.lng);
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function farthestKm(points) {
  let farthest = 0;
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      farthest = Math.max(farthest, distanceKm(points[left], points[right]));
    }
  }
  return farthest;
}

const citySamples = [
  "where_popular-radiohead-lisbon.json",
  "where_popular-amelie-lisbon.json",
  "where_popular-radiohead-johannesburg.json",
  "where_popular-amelie-johannesburg.json",
  "where_popular-radiohead-porto.json",
  "where_popular-amelie-porto.json",
];

for (const fileName of citySamples) {
  const file = path.join(samplesDir, fileName);
  if (!existsSync(file)) continue;
  const body = JSON.parse(await readFile(file, "utf8"));
  const rows = Array.isArray(body.result?.results) ? body.result.results : [];
  const points = rows
    .map((row) => ({ lat: Number(row?.location?.latitude), lng: Number(row?.location?.longitude) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  const spread = points.length > 1 ? farthestKm(points) : 0;
  const scale = points.length < 2
    ? "not enough points"
    : spread <= 8
      ? "neighborhood-level"
      : spread <= 40
        ? "city-level, wider than one neighborhood"
        : "wider than a city";
  console.log(`${fileName}: points=${points.length} status=${body.result?.status ?? "-"} spread=${spread.toFixed(1)} km ${scale}`);
}

for (const fileName of ["entity_tags-amelie-movie.json", "entity_tags-radiohead-artist.json"]) {
  const file = path.join(samplesDir, fileName);
  if (!existsSync(file)) continue;
  const body = JSON.parse(await readFile(file, "utf8"));
  const types = [...new Set((body.result?.results || []).map((tag) => tag.type).filter(Boolean))];
  console.log(`${fileName} tag types: ${types.join(", ") || "(none)"}`);
}
