import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const presetDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../presets");

export const PRESETS = [
  {
    id: "lisbon",
    label: "Lisbon afternoon",
    blurb: "The same favorites, in Lisbon.",
    favorites: ["Radiohead", "Amélie", "ramen"],
    target: "place",
    city: "Lisbon",
  },
  {
    id: "johannesburg",
    label: "Johannesburg night",
    blurb: "Radiohead, Amélie, and ramen, as places.",
    favorites: ["Radiohead", "Amélie", "ramen"],
    target: "place",
    city: "Johannesburg",
  },
  {
    id: "movies",
    label: "Movie night",
    blurb: "Radiohead, Amélie, and ramen, as films.",
    favorites: ["Radiohead", "Amélie", "ramen"],
    target: "movie",
    city: "",
  },
];

function presetKey({ favorites, target, city }) {
  return JSON.stringify({
    favorites: [...favorites].map((item) => item.trim().toLowerCase()).sort(),
    target,
    city: String(city || "").trim().toLowerCase(),
  });
}

export function listPresets() {
  return PRESETS.map((preset) => ({
    ...preset,
    ready: existsSync(path.join(presetDir, `${preset.id}.json`)),
  }));
}

export function savedPreset({ favorites, target, city }) {
  const wanted = presetKey({ favorites, target, city });
  const match = PRESETS.find((preset) => presetKey(preset) === wanted);
  if (!match) return null;
  const file = path.join(presetDir, `${match.id}.json`);
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return { ...saved, preset: true, cached: true, preset_id: match.id };
  } catch {
    return null;
  }
}
