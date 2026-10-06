export const TARGETS = {
  place: "place",
  movie: "movie",
  brand: "brand",
  artist: "artist",
  book: "book",
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function entityFromDescribe(response) {
  const result = response?.body?.result;
  if (!result || result.status !== "ok") return null;
  const interpreted = result.interpretation?.entity;
  const first = Array.isArray(result.results) ? result.results.find((item) => item?.name || item?.entity_id) : null;
  const entityId = interpreted?.entityId || first?.entity_id || null;
  const name = interpreted?.name || first?.name || null;
  const type = interpreted?.type || first?.type || null;
  if (!entityId && !name) return null;
  return { entity_id: entityId, name, type };
}

const PREFERRED_TYPES = ["artist", "movie", "brand", "book", "tv_show", "album", "podcast", "videogame"];

export function candidatesFrom(response) {
  const issues = response?.body?.result?.resolution?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) => (Array.isArray(issue.candidates) ? issue.candidates : []));
}

export function chooseCandidate(candidates, input) {
  const needle = normalize(input);
  const exact = candidates.filter((candidate) => normalize(candidate?.name) === needle);
  const pool = exact.length > 0 ? exact : candidates;
  const preferred = pool.filter((candidate) => PREFERRED_TYPES.some((type) => String(candidate?.type || "").includes(type)));
  const ranked = (preferred.length > 0 ? preferred : pool)
    .filter((candidate) => candidate?.id && candidate?.name)
    .sort((left, right) => {
      const leftRank = PREFERRED_TYPES.findIndex((type) => String(left.type || "").includes(type));
      const rightRank = PREFERRED_TYPES.findIndex((type) => String(right.type || "").includes(type));
      return (leftRank === -1 ? 99 : leftRank) - (rightRank === -1 ? 99 : rightRank)
        || (right.popularity || 0) - (left.popularity || 0);
    });
  return ranked[0] || null;
}

const VENUE = /restaurant|cafe|coffee|bar|bakery|bistro|hotel|museum|gallery|attraction|landmark|nightlife|theater|theatre|venue|market|park|winery|brewery|diner|eatery|food|garden/i;
const NON_VENUE = /organization|organisation|association|society|foundation|company|brand|person|club|nonprofit|charity/i;

function affinityOf(item) {
  return typeof item?.affinity === "number" ? item.affinity : -1;
}

function isNonVenue(item) {
  const subtype = String(item?.subtype || "").replace(/^urn:entity:place:?/i, "");
  const specificVenue = VENUE.test(subtype);
  const orgName = NON_VENUE.test(item?.name || "") || NON_VENUE.test(subtype);
  if (orgName && !specificVenue) return true;
  return false;
}

export function selectRecommendations(results, target) {
  const named = (results || []).filter((item) => item?.name);
  const ranked = [...named].sort((left, right) => affinityOf(right) - affinityOf(left));
  if (target !== "place") return ranked.slice(0, 6);
  const venues = ranked.filter((item) => !isNonVenue(item));
  return (venues.length >= 3 ? venues : ranked).slice(0, 6);
}

function publicItem(match, reason, cited) {
  const address = match.properties?.address;
  return {
    entity_id: match.entity_id || null,
    name: match.name,
    type: match.type || null,
    subtype: match.subtype || null,
    affinity: match.affinity ?? null,
    popularity: match.popularity ?? null,
    address: typeof address === "string" ? address : null,
    reason: String(reason || "Qloo ranked this from your favorites.").slice(0, 400),
    cited_inputs: cited,
  };
}

export function filterItinerary({ results, favorites, items }) {
  const byId = new Map();
  const byName = new Map();
  for (const result of results) {
    if (result?.entity_id) byId.set(String(result.entity_id), result);
    if (result?.name) byName.set(normalize(result.name), result);
  }
  const allowedFavorites = new Set(favorites.map(normalize));
  const used = new Set();
  const kept = [];

  for (const item of items || []) {
    const match = (item?.entity_id && byId.get(String(item.entity_id))) || (item?.name && byName.get(normalize(item.name)));
    if (!match || used.has(String(match.entity_id || match.name))) continue;
    used.add(String(match.entity_id || match.name));
    const cited = Array.isArray(item.cited_inputs)
      ? item.cited_inputs.filter((input) => allowedFavorites.has(normalize(input)))
      : [];
    kept.push(publicItem(
      match,
      item.reason,
      cited.length > 0 ? cited : favorites,
    ));
  }

  return kept;
}

export function fallbackItinerary(results, favorites) {
  return results.slice(0, 6).map((result) => publicItem(
    result,
    `Qloo ranked ${result.name} from the favorites you entered.`,
    favorites,
  ));
}
