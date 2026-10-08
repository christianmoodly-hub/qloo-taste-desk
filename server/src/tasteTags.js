const TAG_LIMIT = 20;
const TAG_KEEP = 6;
const TAG_MIN = 3;

export function isTasteTag(type) {
  const value = String(type || "");
  return value === "urn:tag:keyword:media" || value.endsWith(":qloo");
}

export function selectTasteTags(results) {
  const kept = (Array.isArray(results) ? results : [])
    .filter((tag) => tag?.name && isTasteTag(tag.type))
    .slice(0, TAG_KEEP)
    .map((tag) => ({ name: String(tag.name).trim(), type: String(tag.type) }))
    .filter((tag) => tag.name);
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
