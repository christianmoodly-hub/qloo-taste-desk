import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQueries } from "../src/geocode.js";

test("geocode queries stay short and limited", () => {
  const queries = normalizeQueries(["  Les Créatifs  ", "", "ab", "x".repeat(200), 12, "The Grand, Sandton"]);
  assert.deepEqual(queries, ["Les Créatifs", "The Grand, Sandton"]);
});
