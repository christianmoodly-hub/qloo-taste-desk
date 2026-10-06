import { draftUngrounded, explainWithGemini } from "./gemini.js";
import { TARGETS, candidatesFrom, chooseCandidate, entityFromDescribe, fallbackItinerary, filterItinerary, selectRecommendations } from "./itinerary.js";
import { savedPreset } from "./presets.js";

function cleanList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || trimmed.length > 80 || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
  }
  return cleaned;
}

export function readPlanRequest(body) {
  const favorites = cleanList(body?.favorites);
  const target = typeof body?.target === "string" ? body.target : "";
  const city = typeof body?.city === "string" ? body.city.trim().slice(0, 80) : "";
  if (favorites.length < 3 || favorites.length > 5) {
    return { error: "Enter 3 to 5 favorites." };
  }
  if (!TARGETS[target]) {
    return { error: "Choose a target domain." };
  }
  const mode = body?.mode === "plain" ? "plain" : "qloo";
  return { favorites, target, city, mode, fresh: body?.fresh === true };
}

function plainItems(favorites, items) {
  const allowed = new Set(favorites.map((item) => item.toLowerCase()));
  return (items || []).filter((item) => item?.name).slice(0, 6).map((item) => {
    const cited = Array.isArray(item.cited_inputs)
      ? item.cited_inputs.filter((input) => typeof input === "string" && allowed.has(input.trim().toLowerCase()))
      : [];
    return {
      name: String(item.name).slice(0, 120),
      reason: String(item.reason || "The model named this without a Qloo catalog.").slice(0, 400),
      cited_inputs: cited.length > 0 ? cited : favorites,
      grounded: false,
    };
  });
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return results;
}

async function resolveFavorite(favorite, execute) {
  const described = await execute({ operation: "describe", input: { entity: favorite } });
  const direct = entityFromDescribe(described);
  if (direct?.entity_id && !String(direct.type || "").includes(":place")) {
    return { kind: "entity", input: favorite, name: direct.name, entity_id: direct.entity_id };
  }

  const candidate = chooseCandidate(candidatesFrom(described), favorite);
  if (candidate && !String(candidate.type).includes(":place")) {
    return { kind: "entity", input: favorite, name: candidate.name, entity_id: candidate.id };
  }

  const tags = await execute({ operation: "find_tags", input: { query: favorite, limit: 5 } });
  const tag = (tags.body?.result?.results || []).find((item) => /cuisine|food|dish|ingredient|genre/i.test(String(item?.type || "")));
  if (tag?.id) return { kind: "tag", input: favorite, name: tag.name, entity_id: tag.id };

  if (direct?.entity_id) return { kind: "entity", input: favorite, name: direct.name, entity_id: direct.entity_id };
  if (candidate) return { kind: "entity", input: favorite, name: candidate.name, entity_id: candidate.id };
  return null;
}

export async function planTaste({
  favorites,
  target,
  city,
  mode = "qloo",
  fresh = false,
  execute,
  explain = explainWithGemini,
  explainPlain = draftUngrounded,
  loadSaved = savedPreset,
}) {
  if (mode === "plain") {
    try {
      const drafted = await explainPlain({ favorites, city, target });
      return {
        status: 200,
        body: {
          ok: true,
          mode: "plain",
          grounded: false,
          summary: drafted.summary || "This answer did not use Qloo.",
          target,
          city: city || null,
          items: plainItems(favorites, drafted.items),
          explained: true,
        },
      };
    } catch (error) {
      console.error("explanation unavailable");
      return {
        status: 502,
        body: {
          ok: false,
          error: { code: error?.code || "LLM_FAILED", message: "The plain model could not draft a plan." },
        },
      };
    }
  }

  if (!fresh) {
    const saved = loadSaved({ favorites, target, city });
    if (saved) return { status: 200, body: { ...saved, mode: "qloo", grounded: true } };
  }

  const described = await mapPool(favorites, 2, (favorite) => resolveFavorite(favorite, execute));
  const resolved = described.filter(Boolean);
  const unresolved = favorites.filter((favorite) => !resolved.some((item) => item.input === favorite));
  const signals = resolved.filter((item) => item.kind === "entity").map((item) => item.entity_id);
  const signalTags = resolved.filter((item) => item.kind === "tag").map((item) => item.entity_id);
  if (signals.length === 0 && signalTags.length === 0) {
    return {
      status: 422,
      body: {
        ok: false,
        resolved,
        unresolved,
        error: { code: "UNRESOLVED", message: "Qloo could not resolve any of those favorites." },
      },
    };
  }

  const input = {
    target_type: TARGETS[target],
    limit: target === "place" ? 12 : 6,
    explain: true,
  };
  if (signals.length > 0) input.signals = signals;
  if (signalTags.length > 0) input.signal_tags = signalTags;
  if (target === "place" && city) input.filter_location = city;

  const recommended = await execute({ operation: "recommend", input });
  if (!recommended?.body?.ok) {
    return {
      status: recommended?.status || 502,
      body: {
        ok: false,
        resolved,
        unresolved,
        error: recommended?.body?.error || {
          code: "QLOO_EXEC_FAILED",
          message: "Qloo could not recommend from those favorites.",
        },
      },
    };
  }

  const envelope = recommended.body.result || {};
  if (envelope.status === "needs_input") {
    return {
      status: 422,
      body: {
        ok: false,
        resolved,
        unresolved,
        error: {
          code: "NEEDS_INPUT",
          message: envelope.summary || "Qloo needs a clearer favorite or city.",
        },
      },
    };
  }

  const results = selectRecommendations(
    Array.isArray(envelope.results) ? envelope.results : [],
    target,
  );
  if (results.length === 0) {
    return {
      status: 404,
      body: {
        ok: false,
        resolved,
        unresolved,
        error: { code: "EMPTY", message: "Qloo returned no recommendations for that combination." },
      },
    };
  }

  let explained = false;
  let summary = "";
  let items = [];
  try {
    const drafted = await explain({ favorites, city, target, results });
    items = filterItinerary({ results, favorites, items: drafted.items });
    summary = drafted.summary;
    explained = items.length > 0;
  } catch {
    console.error("explanation unavailable");
    items = [];
  }

  if (items.length === 0) {
    items = fallbackItinerary(results, favorites);
    summary = "Qloo ranked these from your favorites.";
    explained = false;
  }

  return {
    status: 200,
    body: {
      ok: true,
      summary,
      mode: "qloo",
      grounded: true,
      target,
      city: city || null,
      resolved,
      unresolved,
      items,
      qloo_count: results.length,
      explained,
    },
  };
}
