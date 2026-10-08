import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../server/src/env.js";
import { reverseNeighborhood } from "../server/src/nominatim.js";
import { createExecutor } from "../server/src/qlooExec.js";
import { buildTasteMap } from "../server/src/tasteMap.js";
import { buildTasteTags } from "../server/src/tasteTags.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samples = path.join(root, "docs", "samples");
const presets = path.join(root, "server", "presets");

const AMELIE = "B7A0731F-EC92-496A-9C40-47D9770489B6";
const RADIOHEAD = "70CAE5BF-2F4C-445C-A3E5-4EDACFC3591C";

const resolved = [
  { kind: "entity", input: "Radiohead", name: "Radiohead", entity_id: RADIOHEAD, type: "urn:entity:artist" },
  { kind: "entity", input: "Amélie", name: "Amélie", entity_id: AMELIE, type: "urn:entity:movie" },
  { kind: "tag", input: "ramen", name: "Ramen", entity_id: "urn:tag:cuisine:qloo:ramen" },
];

loadEnv();
const executor = createExecutor();
const secrets = [process.env.QLOO_API_KEY, process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY].filter(Boolean);

function assertClean(label, text) {
  if (secrets.some((secret) => text.includes(secret))) {
    throw new Error(`${label} contained a credential`);
  }
}

async function loadOrFetch(fileName, operation, input) {
  const file = path.join(samples, fileName);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const response = await executor.execute({ operation, input });
  const text = `${JSON.stringify(response.body, null, 2)}\n`;
  assertClean(fileName, text);
  writeFileSync(file, text);
  console.log(`saved ${fileName}`);
  return response.body;
}

const tagFiles = {
  [RADIOHEAD]: "entity_tags-radiohead-l20.json",
  [AMELIE]: "entity_tags-amelie-l20.json",
};

for (const [entityId, fileName] of Object.entries(tagFiles)) {
  const entity = resolved.find((item) => item.entity_id === entityId);
  const body = await loadOrFetch(fileName, "entity_tags", {
    entities: [entityId],
    entity_type: entity.entity_id === AMELIE ? "movie" : "artist",
    limit: 20,
  });
  const pairs = (body.result?.results || []).map((tag) => `${tag.name} (${tag.type})`);
  console.log(`${entity.input} tag pairs (${pairs.length}):`);
  for (const pair of pairs) console.log(`  ${pair}`);
}

function heatmapFile(entityId, city) {
  const who = entityId === AMELIE ? "amelie" : "radiohead";
  return `where_popular-${who}-${city.toLowerCase()}-l20.json`;
}

async function execute({ operation, input }) {
  if (operation === "entity_tags") {
    const body = await loadOrFetch(tagFiles[input.entities[0]], operation, input);
    return { status: 200, body };
  }
  if (operation !== "where_popular") throw new Error(`unexpected ${operation}`);
  const body = await loadOrFetch(heatmapFile(input.entity, input.within), operation, input);
  return { status: 200, body };
}

const tasteTags = await buildTasteTags({ resolved, execute });

for (const [id, city] of [["lisbon", "Lisbon"], ["johannesburg", "Johannesburg"]]) {
  const tasteMap = await buildTasteMap({
    resolved,
    city,
    execute,
    labelPlace: reverseNeighborhood,
  });
  const file = path.join(presets, `${id}.json`);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.taste_map = tasteMap;
  saved.taste_tags = tasteTags;
  const text = `${JSON.stringify(saved, null, 2)}\n`;
  assertClean(id, text);
  writeFileSync(file, text);
  console.log(`${id}: ${tasteMap.summary || "(no clusters)"}`);
  console.log(tasteMap.trace.join("\n"));
}
console.log(tasteTags.trace.join("\n"));
