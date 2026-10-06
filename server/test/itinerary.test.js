import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { fallbackItinerary, filterItinerary, chooseCandidate } from "../src/itinerary.js";
import { createRateLimiter } from "../src/rateLimit.js";

const results = [
  { entity_id: "urn:entity:place:1", name: "Cervejaria Ramiro", type: "urn:entity:place", affinity: 0.8 },
  { entity_id: "urn:entity:place:2", name: "Time Out Market", type: "urn:entity:place", affinity: 0.6 },
];

test("itinerary keeps only Qloo items and known favorites", () => {
  const items = filterItinerary({
    results,
    favorites: ["Radiohead", "ramen"],
    items: [
      { entity_id: "urn:entity:place:1", reason: "Late seafood for a Radiohead night.", cited_inputs: ["Radiohead", "Invented"] },
      { name: "A place Qloo did not return", reason: "Skip me.", cited_inputs: ["ramen"] },
      { entity_id: "urn:entity:place:1", reason: "Duplicate.", cited_inputs: ["ramen"] },
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Cervejaria Ramiro");
  assert.deepEqual(items[0].cited_inputs, ["Radiohead"]);
});

test("chooseCandidate prefers the artist when a name is ambiguous", () => {
  const chosen = chooseCandidate(
    [
      { id: "album", name: "Radiohead", type: "urn:entity:album", popularity: 0.99 },
      { id: "artist", name: "Radiohead", type: "urn:entity:artist", popularity: 0.9 },
      { id: "place", name: "Radiohead Cafe", type: "urn:entity:place", popularity: 0.2 },
    ],
    "Radiohead",
  );
  assert.equal(chosen.id, "artist");
});

test("fallback itinerary uses the Qloo list", () => {
  const items = fallbackItinerary(results, ["ramen"]);
  assert.equal(items.length, 2);
  assert.equal(items[1].name, "Time Out Market");
  assert.deepEqual(items[1].cited_inputs, ["ramen"]);
});

test("plan and exec routes share a small per-IP limit", async () => {
  let plans = 0;
  const app = createApp({
    execute: async () => ({ status: 200, body: { ok: true, result: { status: "ok" } } }),
    plan: async () => {
      plans += 1;
      return { status: 200, body: { ok: true, items: [] } };
    },
    rateLimit: createRateLimiter({ max: 2 }),
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const first = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: ["a", "b", "c"], target: "place" }),
    });
    const second = await fetch(`${base}/api/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "find_tags", input: { query: "sneakers" } }),
    });
    const third = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: ["a", "b", "c"], target: "movie" }),
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal(plans, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("plan route rejects the wrong number of favorites before Qloo", async () => {
  let called = false;
  const app = createApp({
    plan: async () => {
      called = true;
      return { status: 200, body: { ok: true } };
    },
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: ["only one"], target: "place", apiKey: "nope" }),
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
