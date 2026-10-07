import { redactSecrets } from "./env.js";

const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash"];
const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

function stripFences(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function failed(detail) {
  const error = new Error("The explanation model could not finish.");
  error.code = "LLM_FAILED";
  error.detail = detail;
  return error;
}

function parsedExplanation(text) {
  const cleaned = stripFences(text || "");
  if (!cleaned) throw failed("The model returned an empty explanation.");
  const parsed = JSON.parse(cleaned);
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "",
    items: Array.isArray(parsed.items) ? parsed.items : [],
  };
}

async function generateWithGemini(prompt, env) {
  const preferred = hasValue(env.GEMINI_MODEL) ? [env.GEMINI_MODEL] : [];
  const models = [...new Set([...preferred, ...GEMINI_MODELS])];
  let lastError;
  for (const candidate of models) {
    let response;
    try {
      response = await fetch(
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
    } catch {
      lastError = failed("Gemini request failed.");
      continue;
    }

    const raw = await response.text();
    if (!response.ok) {
      lastError = failed(redactSecrets(raw, env).slice(0, 300));
      continue;
    }

    try {
      const payload = JSON.parse(raw);
      const text = (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
      return parsedExplanation(text);
    } catch {
      lastError = failed("Gemini returned an unreadable explanation.");
    }
  }
  throw lastError;
}

async function generateWithGroq(prompt, env) {
  const preferred = hasValue(env.GROQ_MODEL) ? [env.GROQ_MODEL] : [];
  const models = [...new Set([...preferred, ...GROQ_MODELS])];
  let lastError;
  for (const candidate of models) {
    let response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: candidate,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return one JSON object and nothing else." },
            { role: "user", content: prompt },
          ],
        }),
      });
    } catch {
      lastError = failed("Groq request failed.");
      continue;
    }

    const raw = await response.text();
    if (!response.ok) {
      lastError = failed(redactSecrets(raw, env).slice(0, 300));
      continue;
    }

    try {
      const payload = JSON.parse(raw);
      return parsedExplanation(payload.choices?.[0]?.message?.content || "");
    } catch {
      lastError = failed("Groq returned an unreadable explanation.");
    }
  }
  throw lastError;
}

async function generateJson(prompt, env) {
  const geminiReady = hasValue(env.GEMINI_API_KEY);
  const groqReady = hasValue(env.GROQ_API_KEY);
  if (!geminiReady && !groqReady) {
    const error = new Error("No explanation model is configured.");
    error.code = "LLM_AUTH";
    throw error;
  }

  if (geminiReady) {
    try {
      return await generateWithGemini(prompt, env);
    } catch (error) {
      if (!groqReady) throw error;
    }
  }

  return generateWithGroq(prompt, env);
}

export async function explainWithGemini({ favorites, city, target, results }, env = process.env) {
  const catalog = results.map((item) => ({
    entity_id: item.entity_id,
    name: item.name,
    type: item.type,
    subtype: item.subtype,
    affinity: item.affinity,
    popularity: item.popularity,
  }));
  const prompt = [
    "Arrange a short plan using only the Qloo results in the catalog.",
    "Do not invent venues, titles, brands, or any item that is not in the catalog.",
    "Each cited_inputs value must be copied exactly from the favorites list.",
    "Each reason must name the cited favorites and say how they connect to that catalog item.",
    "Return JSON with a summary string and an items array.",
    "Each item needs entity_id, reason, and cited_inputs.",
    `Favorites: ${JSON.stringify(favorites)}`,
    `Target domain: ${target}`,
    `City: ${city || "none"}`,
    `Catalog: ${JSON.stringify(catalog)}`,
  ].join("\n");

  return generateJson(prompt, env);
}

export async function draftUngrounded({ favorites, city, target }, env = process.env) {
  const prompt = [
    "Draft a short plan from the favorites alone. You have no catalog and no taste graph.",
    "Name specific items in the target domain. They do not need to be verified.",
    "Each cited_inputs value must be copied exactly from the favorites list.",
    "Return JSON with a summary string and an items array.",
    "Each item needs name, reason, and cited_inputs.",
    `Favorites: ${JSON.stringify(favorites)}`,
    `Target domain: ${target}`,
    `City: ${city || "none"}`,
  ].join("\n");

  return generateJson(prompt, env);
}
