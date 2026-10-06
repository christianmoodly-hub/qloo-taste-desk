import { llmConfigured, redactSecrets } from "./env.js";

const DEFAULT_MODEL = "gemini-3.8-flash";

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export async function explainWithGemini({ favorites, city, target, results }, env = process.env) {
  if (!llmConfigured(env)) {
    const error = new Error("Gemini credential is not configured.");
    error.code = "LLM_AUTH";
    throw error;
  }

  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL] : [DEFAULT_MODEL, "gemini-3.7-flash"];
  const catalog = results.map((item) => ({
    entity_id: item.entity_id,
    name: item.name,
    type: item.type,
    affinity: item.affinity,
  }));
  const prompt = [
    "Arrange a short plan using only the Qloo results in the catalog.",
    "Do not invent venues, titles, brands, or any item that is not in the catalog.",
    "Each cited_inputs value must be copied exactly from the favorites list.",
    "Return JSON with a summary string and an items array.",
    "Each item needs entity_id, reason, and cited_inputs.",
    `Favorites: ${JSON.stringify(favorites)}`,
    `Target domain: ${target}`,
    `City: ${city || "none"}`,
    `Catalog: ${JSON.stringify(catalog)}`,
  ].join("\n");

  let lastError;
  for (const candidate of models) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidate)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    const raw = await response.text();
    if (response.status === 404 || response.status === 503) {
      lastError = new Error("Gemini could not explain the Qloo results.");
      lastError.code = "LLM_FAILED";
      lastError.detail = redactSecrets(raw, env).slice(0, 300);
      continue;
    }
    if (!response.ok) {
      const error = new Error("Gemini could not explain the Qloo results.");
      error.code = "LLM_FAILED";
      error.detail = redactSecrets(raw, env).slice(0, 300);
      throw error;
    }

    const payload = JSON.parse(raw);
    const text = (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
    const parsed = JSON.parse(stripFences(text));
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "",
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  }
  throw lastError;
}
