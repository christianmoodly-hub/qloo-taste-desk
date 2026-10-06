import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/src/app.js";
import { loadEnv, redactSecrets } from "../server/src/env.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplesDir = path.join(root, "docs", "samples");

const calls = [
  ["find_tags", { query: "sneakers", limit: 5 }],
  ["describe", { entity: "Nike", type: "brand" }],
  ["recommend", { target_type: "place", signals: ["Radiohead", "ramen"], filter_location: "Lisbon", limit: 5 }],
];

loadEnv();

const server = await new Promise((resolve) => {
  const listening = createApp().listen(0, "127.0.0.1", () => resolve(listening));
});
const base = `http://127.0.0.1:${server.address().port}`;

try {
  await mkdir(samplesDir, { recursive: true });
  for (const [operation, input] of calls) {
    const response = await fetch(`${base}/api/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation, input }),
    });
    const body = await response.json();
    const text = redactSecrets(JSON.stringify(body, null, 2));
    if (text.includes(process.env.QLOO_API_KEY || "___no_qloo_key___") || text.includes(process.env.GEMINI_API_KEY || "___no_gemini_key___")) {
      throw new Error(`${operation} sample still contains a credential`);
    }
    await writeFile(path.join(samplesDir, `${operation}.json`), `${text}\n`);
    console.log(`${operation}: HTTP ${response.status} ok=${body.ok === true}`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
