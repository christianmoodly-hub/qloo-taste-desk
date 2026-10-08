import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function loadEnv() {
  dotenv.config({ path: path.join(rootDir, ".env") });
}

export function credentialConfigured(env = process.env) {
  return typeof env.QLOO_API_KEY === "string" && env.QLOO_API_KEY.trim().length > 0;
}

export function llmConfigured(env = process.env) {
  const gemini = typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.trim().length > 0;
  const groq = typeof env.GROQ_API_KEY === "string" && env.GROQ_API_KEY.trim().length > 0;
  return gemini || groq;
}

const SECRET_ENV_NAMES = ["QLOO_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "UNSPLASH_ACCESS_KEY"];

export function redactSecrets(text, env = process.env) {
  if (typeof text !== "string" || text.length === 0) return "";
  let redacted = text;
  for (const name of SECRET_ENV_NAMES) {
    const secret = env[name];
    if (typeof secret === "string" && secret.length > 0) {
      redacted = redacted.split(secret).join("[redacted]");
    }
  }
  return redacted;
}
