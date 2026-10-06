import assert from "node:assert/strict";
import test from "node:test";
import { explainWithGemini } from "../src/gemini.js";

const demand = JSON.stringify({
  error: { message: "This model is currently experiencing high demand. Please try again later." },
});

test("Gemini high demand stays on the server and Groq answers", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("generativelanguage")) {
      return new Response(demand, { status: 503 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary: "A quiet night.", items: [] }) } }],
    }), { status: 200 });
  };
  try {
    const result = await explainWithGemini(
      { favorites: ["ramen"], city: "Lisbon", target: "place", results: [] },
      { GEMINI_API_KEY: "gem", GROQ_API_KEY: "groq" },
    );
    assert.equal(result.summary, "A quiet night.");
    assert.equal(calls.filter((url) => url.includes("generativelanguage")).length, 2);
    assert.equal(calls.some((url) => url.includes("api.groq.com")), true);
  } finally {
    globalThis.fetch = original;
  }
});
