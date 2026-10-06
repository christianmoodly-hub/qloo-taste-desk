import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../server/src/env.js";
import { planTaste } from "../server/src/planTaste.js";
import { PRESETS } from "../server/src/presets.js";
import { createExecutor } from "../server/src/qlooExec.js";

loadEnv();

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../server/presets");
mkdirSync(dir, { recursive: true });

const executor = createExecutor();
const qlooKey = process.env.QLOO_API_KEY || "";
const geminiKey = process.env.GEMINI_API_KEY || "";

for (const preset of PRESETS) {
  const response = await planTaste({
    favorites: preset.favorites,
    target: preset.target,
    city: preset.city,
    fresh: true,
    loadSaved: () => null,
    execute: executor.execute,
  });
  if (response.status !== 200 || response.body?.ok !== true) {
    console.error(`${preset.id} failed (${response.status})`);
    process.exitCode = 1;
    continue;
  }
  const text = `${JSON.stringify(response.body, null, 2)}\n`;
  if ((qlooKey && text.includes(qlooKey)) || (geminiKey && text.includes(geminiKey))) {
    console.error(`${preset.id} contained a credential, so it was not written`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(path.join(dir, `${preset.id}.json`), text);
  const names = (response.body.items || []).map((item) => item.name).join(", ");
  console.log(`${preset.id}: ${names}`);
}
