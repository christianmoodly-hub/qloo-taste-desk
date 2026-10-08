import test from "node:test";
import assert from "node:assert/strict";
import { publicPhoto } from "../src/unsplash.js";

test("a city photograph keeps the photographer credit", () => {
  const photo = publicPhoto({
    alt_description: "Skyline at dusk",
    urls: { regular: "https://images.unsplash.com/photo-1" },
    user: { name: "Ada Lens", links: { html: "https://unsplash.com/@ada" } },
    links: { html: "https://unsplash.com/photos/abc" },
  }, "Lisbon");
  assert.equal(photo.imageUrl, "https://images.unsplash.com/photo-1");
  assert.equal(photo.photographer, "Ada Lens");
  assert.match(photo.photographerUrl, /utm_source=taste_desk/);
  assert.match(photo.unsplashUrl, /unsplash.com/);
});
