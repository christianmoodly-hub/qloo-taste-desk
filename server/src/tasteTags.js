const TAG_LIMIT = 20;
const TAG_KEEP = 6;
const TAG_MIN = 3;
const BLOCKED_NAMES = new Set(["musician", "entertainment"]);
const GENRE_TYPES = new Set(["urn:tag:genre:music", "urn:tag:genre:media"]);

export function isTasteTag(type) {
  const value = String(type || "");
  return value === "urn:tag:keyword:media" || value.endsWith(":qloo") || GENRE_TYPES.has(value);
}

function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function wordsOf(name) {
  return cleanName(name).toLowerCase().split(" ").filter(Boolean);
}

function isWordSubset(shorter, longer) {
  if (shorter.length === 0 || shorter.length >= longer.length) return false;
  const pool = new Set(longer);
  return shorter.every((word) => pool.has(word));
}

export function selectTasteTags(results) {
  const candidates = (Array.isArray(results) ? results : [])
    .filter((tag) => tag?.name && isTasteTag(tag.type))
    .map((tag) => ({ name: cleanName(tag.name), type: String(tag.type) }))
    .filter((tag) => tag.name && !BLOCKED_NAMES.has(tag.name.toLowerCase()));

  const deduped = [];
  for (const tag of candidates) {
    const tagWords = wordsOf(tag.name);
    const matchIndex = deduped.findIndex((kept) => {
      const keptWords = wordsOf(kept.name);
      if (keptWords.join(" ") === tagWords.join(" ")) return true;
      return isWordSubset(keptWords, tagWords) || isWordSubset(tagWords, keptWords);
    });
    if (matchIndex === -1) {
      deduped.push(tag);
      continue;
    }
    if (tagWords.length > wordsOf(deduped[matchIndex].name).length) {
      deduped[matchIndex] = tag;
    }
  }

  const kept = deduped.slice(0, TAG_KEEP);
  return kept.length >= TAG_MIN ? kept : [];
}

export async function buildTasteTags({ resolved, execute }) {
  const items = Array.isArray(resolved) ? resolved.filter(Boolean) : [];
  const favorites = [];
  const trace = [];
  for (const item of items) {
    if (item.kind !== "entity" || !item.entity_id) {
      trace.push(`Skipped ${item.input} taste tags`);
      continue;
    }
    const input = { entities: [item.entity_id], limit: TAG_LIMIT };
    const entityType = searchType(item.type);
    if (entityType) input.entity_type = entityType;
    let response;
    try {
      response = await execute({ operation: "entity_tags", input });
    } catch {
      trace.push(`Skipped ${item.input} taste tags`);
      continue;
    }
    const tags = selectTasteTags(response?.body?.result?.results);
    if (tags.length < TAG_MIN) {
      trace.push(`Skipped ${item.input} taste tags`);
      continue;
    }
    trace.push(`Kept taste tags for ${item.input}`);
    favorites.push({ name: item.input || item.name, tags });
  }
  return { favorites, trace };
}

function searchType(type) {
  const tail = String(type || "").split(":").filter(Boolean).pop()?.toLowerCase() || "";
  const allowed = new Set([
    "artist", "book", "brand", "movie", "person", "place", "podcast",
    "tv_show", "videogame", "locality", "actor", "album", "author", "director",
  ]);
  return allowed.has(tail) ? tail : "";
}
