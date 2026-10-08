import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { planTaste } from "../src/planTaste.js";
import { buildTasteMap, cityScope, clusterFavoritePoints, distanceKm, findOverlaps, heatmapPoints, tasteMapSummary } from "../src/tasteMap.js";
import { selectTasteTags } from "../src/tasteTags.js";

const samples = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples");

function fixture(name) {
  return JSON.parse(readFileSync(path.join(samples, name), "utf8"));
}

function pointsOf(name) {
  return heatmapPoints(fixture(name).result);
}

test("city scope is the text before a comma", () => {
  assert.equal(cityScope("Lisbon"), "Lisbon");
  assert.equal(cityScope("Johannesburg, South Africa"), "Johannesburg");
  assert.equal(cityScope("  Porto, Portugal "), "Porto");
  assert.equal(cityScope(""), "");
});

test("saved city samples cluster per favorite on a neighborhood grid", () => {
  const radiohead = clusterFavoritePoints(pointsOf("where_popular-radiohead-lisbon.json"));
  const amelie = clusterFavoritePoints(pointsOf("where_popular-amelie-lisbon.json"));
  const porto = clusterFavoritePoints(pointsOf("where_popular-radiohead-porto.json"));
  const joburg = clusterFavoritePoints(pointsOf("where_popular-radiohead-johannesburg.json"));
  for (const clusters of [radiohead, amelie, porto, joburg]) {
    assert.ok(clusters.length >= 1 && clusters.length <= 2);
    assert.equal(clusters.some((cluster) => "sources" in cluster), false);
  }
  assert.ok(radiohead.every((cluster) => cluster.latitude > 38.69 && cluster.latitude < 38.75));
  assert.ok(distanceKm(amelie[0], amelie[1]) > 5);
  const radioheadTotal = pointsOf("where_popular-radiohead-lisbon.json").reduce((sum, point) => sum + point.affinity, 0);
  const radioheadKept = radiohead.reduce((sum, cluster) => sum + cluster.weight, 0);
  assert.ok(radioheadKept > 0 && radioheadKept <= radioheadTotal + 0.001);
});

test("an empty heatmap is recorded and does not fall back to a country", async () => {
  const calls = [];
  const map = await buildTasteMap({
    city: "Johannesburg, South Africa",
    labelPlace: async () => "Rosebank",
    resolved: [
      { kind: "entity", input: "Radiohead", entity_id: "artist-1", type: "urn:entity:artist" },
      { kind: "tag", input: "ramen", entity_id: "urn:tag:cuisine:qloo:ramen" },
      { kind: "entity", input: "Amélie", entity_id: "movie-1", type: "urn:entity:movie" },
    ],
    execute: async ({ operation, input }) => {
      calls.push(input);
      if (input.entity === "movie-1") return { body: fixture("where_popular-amelie-johannesburg.json") };
      return { body: fixture("where_popular-radiohead-johannesburg.json") };
    },
  });
  assert.deepEqual(calls.map((input) => input.within), ["Johannesburg", "Johannesburg"]);
  assert.deepEqual(calls.map((input) => input.limit), [20, 20]);
  assert.equal(map.favorites.length, 1);
  assert.equal(map.favorites[0].name, "Radiohead");
  assert.equal(map.favorites[0].clusters[0].label, "Rosebank");
  assert.match(map.summary, /Radiohead fans point toward Rosebank/);
  assert.equal(map.summary.includes("°"), false);
  assert.ok(map.trace.includes("No heatmap for Amélie in Johannesburg"));
  assert.ok(map.trace.includes("Skipped ramen for the taste map"));
  assert.equal(map.trace.some((line) => /South Africa|Portugal/.test(line)), false);
});

test("overlaps stay labeled per favorite instead of blending scores", () => {
  const favorites = [
    {
      name: "Radiohead",
      clusters: [{ latitude: 41.15, longitude: -8.61, weight: 3, label: "Cedofeita" }],
    },
    {
      name: "Amélie",
      clusters: [{ latitude: 41.155, longitude: -8.612, weight: 1, label: "Vitória" }],
    },
  ];
  const overlaps = findOverlaps(favorites);
  assert.equal(overlaps.length, 1);
  assert.deepEqual(overlaps[0].favorites, ["Radiohead", "Amélie"]);
  assert.equal(tasteMapSummary(favorites, overlaps), "Radiohead and Amélie fans both point toward Cedofeita.");
});

test("taste tags keep qloo and media keyword types and drop a short list", () => {
  const amelie = selectTasteTags(fixture("entity_tags-amelie-movie.json").result.results);
  const radiohead = selectTasteTags(fixture("entity_tags-radiohead-artist.json").result.results);
  assert.equal(amelie.length, 6);
  assert.ok(amelie.every((tag) => tag.type.endsWith(":qloo")));
  assert.deepEqual(radiohead, []);
  assert.deepEqual(selectTasteTags([
    { name: "surrealism", type: "urn:tag:keyword:media" },
    { name: "Bar", type: "urn:tag:genre:place" },
    { name: "Experimental", type: "urn:tag:genre:qloo" },
    { name: "Melancholy", type: "urn:tag:keyword:qloo" },
  ]).map((tag) => tag.name), ["surrealism", "Experimental", "Melancholy"]);
});

test("a plan uses the city name and the sample response shape", async () => {
  const calls = [];
  const response = await planTaste({
    favorites: ["Radiohead", "ramen", "Amélie"],
    target: "place",
    city: "Lisbon, Portugal",
    fresh: true,
    loadSaved: () => null,
    labelPlace: async (lat) => (lat > 38.8 ? "Cascais" : "Baixa"),
    execute: async ({ operation, input }) => {
      calls.push({ operation, input });
      if (operation === "where_popular" && input.entity === "artist-1") {
        return { status: 200, body: fixture("where_popular-radiohead-lisbon.json") };
      }
      if (operation === "where_popular" && input.entity === "movie-1") {
        return { status: 200, body: fixture("where_popular-amelie-lisbon.json") };
      }
      if (operation === "entity_tags" && input.entities?.[0] === "artist-1") {
        return { status: 200, body: fixture("entity_tags-radiohead-artist.json") };
      }
      if (operation === "entity_tags" && input.entities?.[0] === "movie-1") {
        return { status: 200, body: fixture("entity_tags-amelie-movie.json") };
      }
      if (operation === "describe" && input.entity === "Radiohead") {
        return { body: { result: { status: "ok", interpretation: { entity: { entityId: "artist-1", name: "Radiohead", type: "urn:entity:artist" } } } } };
      }
      if (operation === "describe" && input.entity === "Amélie") {
        return { body: { result: { status: "ok", interpretation: { entity: { entityId: "movie-1", name: "Amélie", type: "urn:entity:movie" } } } } };
      }
      if (operation === "describe") return { body: { result: { status: "needs_input" } } };
      if (operation === "find_tags") {
        return { body: { result: { results: [{ id: "urn:tag:cuisine:qloo:ramen", name: "Ramen", type: "urn:tag:cuisine" }] } } };
      }
      return {
        status: 200,
        body: { ok: true, result: { status: "ok", results: [{ entity_id: "v1", name: "Jazz Club", subtype: "restaurant", affinity: 0.7 }] } },
      };
    },
    explain: async () => ({
      summary: "A grounded night.",
      items: [{ entity_id: "v1", name: "Jazz Club", reason: "Because Radiohead.", cited_inputs: ["Radiohead"] }],
    }),
  });

  const heatmaps = calls.filter((call) => call.operation === "where_popular");
  const tags = calls.filter((call) => call.operation === "entity_tags");
  assert.deepEqual(heatmaps.map((call) => call.input.within), ["Lisbon", "Lisbon"]);
  assert.deepEqual(heatmaps.map((call) => call.input.limit), [20, 20]);
  assert.deepEqual(tags.map((call) => call.input.limit), [20, 20]);
  assert.deepEqual(response.body.taste_map.favorites.map((favorite) => favorite.name), ["Radiohead", "Amélie"]);
  assert.equal(response.body.taste_map.favorites[0].clusters.length <= 2, true);
  assert.equal(response.body.taste_tags.favorites.length, 1);
  assert.equal(response.body.taste_tags.favorites[0].name, "Amélie");
  assert.equal(response.body.taste_tags.favorites[0].tags.length, 6);
  assert.match(response.body.taste_map.summary, /fans/);
  assert.equal(/\d+\.\d+°/.test(response.body.taste_map.summary), false);
  assert.ok(response.body.trace.includes("Called where_popular for Radiohead within Lisbon"));
  assert.ok(response.body.trace.includes("Called where_popular for Amélie within Lisbon"));
  assert.ok(response.body.trace.includes("Skipped ramen for the taste map"));
  assert.ok(response.body.trace.includes("Kept taste tags for Amélie"));
  assert.ok(response.body.trace.includes("Skipped Radiohead taste tags"));
});

test("a saved preset returns its city map and tags without calling Qloo", async () => {
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
        city: "Johannesburg",
        summary: "Radiohead fans point toward Rosebank.",
        favorites: [{
          name: "Radiohead",
          color: "#2c241c",
          clusters: [{ latitude: -26.03, longitude: 28.01, weight: 2, count: 3, label: "Rosebank" }],
        }],
        overlaps: [],
        trace: ["Called where_popular for Radiohead within Johannesburg", "Skipped ramen for the taste map"],
      },
      taste_tags: {
        favorites: [{ name: "Amélie", tags: [{ name: "Whimsical", type: "urn:tag:subgenre:qloo" }] }],
        trace: ["Kept taste tags for Amélie"],
      },
    }),
  });
  assert.equal(called, false);
  assert.equal(response.body.taste_map.favorites[0].clusters[0].label, "Rosebank");
  assert.equal(response.body.taste_tags.favorites[0].tags[0].name, "Whimsical");
  assert.deepEqual(response.body.trace.slice(-3), [
    "Called where_popular for Radiohead within Johannesburg",
    "Skipped ramen for the taste map",
    "Kept taste tags for Amélie",
  ]);
});
