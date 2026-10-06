import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { fallbackItinerary, filterItinerary, chooseCandidate, selectRecommendations } from "../src/itinerary.js";
import { planTaste } from "../src/planTaste.js";
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

test("place results drop organizations when enough venues remain", () => {
  const picked = selectRecommendations(
    [
      { name: "SA Culinary Club", subtype: "urn:entity:place", affinity: 0.99, properties: { short_description: "A food club.", address: "1 Main" } },
      { name: "Les Créatifs Restaurant", subtype: "restaurant", affinity: 0.4, properties: { address: "1 Main" } },
      { name: "Jazz Club", subtype: "restaurant", affinity: 0.7 },
      { name: "Montecasino Bird Gardens", subtype: "attraction", affinity: 0.5 },
      { name: "Quiet Museum", affinity: 0.2, properties: { short_description: "A museum of film." } },
    ],
    "place",
  );
  assert.deepEqual(picked.map((item) => item.name), [
    "Jazz Club",
    "Montecasino Bird Gardens",
    "Les Créatifs Restaurant",
    "Quiet Museum",
  ]);
});

test("saved preset answers without calling Qloo", async () => {
  let called = false;
  const response = await planTaste({
    favorites: ["Radiohead", "Amélie", "ramen"],
    target: "place",
    city: "Johannesburg",
    execute: async () => {
      called = true;
      throw new Error("Qloo should not run");
    },
    loadSaved: () => ({ ok: true, summary: "Saved for judging.", items: [{ name: "Les Créatifs Restaurant" }] }),
  });
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.equal(response.body.grounded, true);
  assert.equal(response.body.items[0].name, "Les Créatifs Restaurant");
});

test("plain mode keeps names Qloo never returned", async () => {
  let called = false;
  const response = await planTaste({
    favorites: ["Radiohead", "Amélie", "ramen"],
    target: "place",
    city: "Johannesburg",
    mode: "plain",
    execute: async () => {
      called = true;
      throw new Error("Qloo should not run");
    },
    explainPlain: async () => ({
      summary: "A model-only night.",
      items: [{ name: "Invented Bistro", reason: "Because of ramen.", cited_inputs: ["ramen", "not a favorite"] }],
    }),
  });
  assert.equal(called, false);
  assert.equal(response.body.grounded, false);
  assert.equal(response.body.items[0].name, "Invented Bistro");
  assert.deepEqual(response.body.items[0].cited_inputs, ["ramen"]);
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
