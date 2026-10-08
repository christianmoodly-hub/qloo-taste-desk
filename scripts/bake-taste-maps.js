import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reverseLocality } from "../server/src/geocode.js";
import { loadEnv } from "../server/src/env.js";
import { createExecutor } from "../server/src/qlooExec.js";
import { buildTasteMap } from "../server/src/tasteMap.js";

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

const sampleFor = {
  "Radiohead|Portugal": "where_popular-radiohead-portugal.json",
  "Amélie|Portugal": "where_popular-amelie-portugal.json",
  "Radiohead|South Africa": "where_popular-radiohead-south-africa.json",
  "Amélie|South Africa": "where_popular-amelie-south-africa.json",
};

loadEnv();
const executor = createExecutor();
const secrets = [process.env.QLOO_API_KEY, process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY].filter(Boolean);

function readSample(fileName) {
  return JSON.parse(readFileSync(path.join(samples, fileName), "utf8"));
}

async function execute({ operation, input }) {
  if (operation !== "where_popular") throw new Error(`unexpected ${operation}`);
  const key = `${input.entity === AMELIE ? "Amélie" : "Radiohead"}|${input.within}`;
  const fileName = sampleFor[key];
  const file = path.join(samples, fileName);
  try {
    return { status: 200, body: readSample(fileName) };
  } catch {
    const response = await executor.execute({ operation, input });
    const text = `${JSON.stringify(response.body, null, 2)}\n`;
    if (secrets.some((secret) => text.includes(secret))) {
      throw new Error(`${fileName} contained a credential`);
    }
    writeFileSync(file, text);
    console.log(`saved ${fileName}`);
    return response;
  }
}

for (const [id, city] of [["johannesburg", "Johannesburg"], ["lisbon", "Lisbon"]]) {
  const tasteMap = await buildTasteMap({ resolved, city, execute, labelPlace: reverseLocality });
  const file = path.join(presets, `${id}.json`);
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved.taste_map = tasteMap;
  const text = `${JSON.stringify(saved, null, 2)}\n`;
  if (secrets.some((secret) => text.includes(secret))) {
    throw new Error(`${id} preset contained a credential`);
  }
  writeFileSync(file, text);
  console.log(`${id}: ${tasteMap.summary || "(no clusters)"}`);
  console.log(tasteMap.trace.join("\n"));
}
