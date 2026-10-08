import assert from "node:assert/strict";
import test from "node:test";
import { planTaste } from "../src/planTaste.js";
import { clusterTastePoints, countryForCity, tasteMapSummary } from "../src/tasteMap.js";

test("country comes from a known city or the text after a comma", () => {
  assert.equal(countryForCity("Johannesburg"), "South Africa");
  assert.equal(countryForCity("Lisbon"), "Portugal");
  assert.equal(countryForCity("Brooklyn, United States"), "United States");
  assert.equal(countryForCity(""), "");
  assert.equal(countryForCity("Reykjavik"), "");
});

test("nearby affinities combine and a distant point stays its own cluster", () => {
  const clusters = clusterTastePoints([
    { lat: 38.72, lng: -9.14, affinity: 0.8, source: "Amélie" },
    { lat: 38.7, lng: -9.1, affinity: 1, source: "Radiohead" },
    { lat: 41.15, lng: -8.63, affinity: 0.4, source: "Amélie" },
  ]);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].weight, 1.8);
  assert.equal(clusters[0].count, 2);
  assert.deepEqual(clusters[0].sources, ["Radiohead", "Amélie"]);
  assert.equal(clusters[1].weight, 0.4);
  assert.equal(clusters[1].sources[0], "Amélie");
});

test("summary names the strongest aggregate areas", () => {
  const summary = tasteMapSummary([
    { latitude: 38.71, longitude: -9.12, label: "Lisbon" },
    { latitude: 41.15, longitude: -8.63, label: "Porto" },
  ], "Portugal");
  assert.equal(summary, "The strongest aggregate pattern in Portugal sits around Lisbon, then Porto.");
});

test("taste map calls where_popular once per resolved entity and skips tags", async () => {
  const calls = [];
  const response = await planTaste({
    favorites: ["Radiohead", "ramen", "Amélie"],
    target: "place",
    city: "Lisbon",
    fresh: true,
    loadSaved: () => null,
    labelPlace: async () => "Lisbon",
    execute: async ({ operation, input }) => {
      if (operation === "where_popular") {
        calls.push(input);
        const north = input.entity === "movie-1";
        return {
          status: 200,
          body: {
            ok: true,
            result: {
              status: "ok",
              results: [
                {
                  location: { latitude: north ? 38.72 : 38.7, longitude: north ? -9.14 : -9.1 },
                  query: { affinity: north ? 0.5 : 1 },
                },
                ...(north ? [{
                  location: { latitude: 41.15, longitude: -8.63 },
                  query: { affinity: 0.4 },
                }] : []),
              ],
            },
          },
        };
      }
      if (operation === "describe" && input.entity === "Radiohead") {
        return {
          body: {
            result: {
              status: "ok",
              interpretation: { entity: { entityId: "artist-1", name: "Radiohead", type: "urn:entity:artist" } },
            },
          },
        };
      }
      if (operation === "describe" && input.entity === "Amélie") {
        return {
          body: {
            result: {
              status: "ok",
              interpretation: { entity: { entityId: "movie-1", name: "Amélie", type: "urn:entity:movie" } },
            },
          },
        };
      }
      if (operation === "describe") return { body: { result: { status: "needs_input" } } };
      if (operation === "find_tags") {
        return {
          body: {
            result: { results: [{ id: "urn:tag:cuisine:qloo:ramen", name: "Ramen", type: "urn:tag:cuisine" }] },
          },
        };
      }
      return {
        status: 200,
        body: {
          ok: true,
          result: {
            status: "ok",
            results: [{ entity_id: "v1", name: "Jazz Club", subtype: "restaurant", affinity: 0.7 }],
          },
        },
      };
    },
    explain: async () => ({
      summary: "A grounded night.",
      items: [{ entity_id: "v1", name: "Jazz Club", reason: "Because Radiohead.", cited_inputs: ["Radiohead"] }],
    }),
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((input) => input.entity), ["artist-1", "movie-1"]);
  assert.deepEqual(calls.map((input) => input.within), ["Portugal", "Portugal"]);
  assert.deepEqual(calls.map((input) => input.entity_type), ["artist", "movie"]);
  assert.equal(response.body.taste_map.clusters.length, 2);
  assert.equal(response.body.taste_map.clusters[0].weight, 1.5);
  assert.equal(response.body.taste_map.summary, "The strongest aggregate pattern in Portugal sits around Lisbon, then Lisbon.");
  assert.deepEqual(response.body.trace.slice(-3), [
    "Called where_popular for Radiohead within Portugal",
    "Skipped ramen for the taste map",
    "Called where_popular for Amélie within Portugal",
  ]);
});

test("a saved preset returns its taste map without calling Qloo", async () => {
  let called = false;
  const response = await planTaste({
    favorites: ["Radiohead", "Amélie", "ramen"],
    target: "place",
    city: "Johannesburg",
    execute: async () => {
      called = true;
      throw new Error("Qloo should not run");
    },
    loadSaved: () => ({
      ok: true,
      summary: "Saved for judging.",
      resolved: [{ kind: "entity", input: "Radiohead", name: "Radiohead", entity_id: "artist-1", type: "urn:entity:artist" }],
      items: [{ name: "Les Créatifs Restaurant" }],
      taste_map: {
        country: "South Africa",
        summary: "The strongest aggregate pattern in South Africa sits around Cape Town.",
        clusters: [{ latitude: -33.9, longitude: 18.4, weight: 1.2, count: 2, sources: ["Radiohead"] }],
        trace: [
          "Called where_popular for Radiohead within South Africa",
          "Skipped ramen for the taste map",
        ],
      },
    }),
  });
  assert.equal(called, false);
  assert.equal(response.body.taste_map.clusters[0].latitude, -33.9);
  assert.deepEqual(response.body.trace, [
    "Resolved Radiohead → chose artist",
    "Called recommend for places in Johannesburg",
    "Called where_popular for Radiohead within South Africa",
    "Skipped ramen for the taste map",
  ]);
});
