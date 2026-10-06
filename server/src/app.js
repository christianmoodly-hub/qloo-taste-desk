import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { credentialConfigured, llmConfigured } from "./env.js";
import { OPERATION_IDS, OPERATIONS, containsSecretField } from "./operations.js";
import { planTaste, readPlanRequest } from "./planTaste.js";
import { listPresets } from "./presets.js";
import { createExecutor } from "./qlooExec.js";
import { createRateLimiter } from "./rateLimit.js";

const LOCAL_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createApp({ execute, plan, rateLimit } = {}) {
  const executor = execute ? { execute } : createExecutor();
  const planRequest = plan || ((request) => planTaste({ ...request, execute: executor.execute }));
  const limit = rateLimit || createRateLimiter();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === "string" && LOCAL_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      credentialConfigured: credentialConfigured(),
      llmConfigured: llmConfigured(),
    });
  });

  app.get("/api/operations", (_req, res) => {
    res.json({ operations: OPERATIONS });
  });

  app.get("/api/presets", (_req, res) => {
    res.json({ presets: listPresets() });
  });

  app.post("/api/exec", limit, async (req, res, next) => {
    try {
      const body = req.body;
      if (!isPlainObject(body) || containsSecretField(body)) {
        res.status(400).json({
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: "Send { operation, input }. Credentials are not accepted.",
          },
        });
        return;
      }

      const operation = body.operation;
      const input = body.input;
      if (typeof operation !== "string" || !isPlainObject(input)) {
        res.status(400).json({
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: "operation must be a string and input must be a JSON object.",
          },
        });
        return;
      }
      if (!OPERATION_IDS.has(operation)) {
        res.status(400).json({
          ok: false,
          error: { code: "UNKNOWN_OPERATION", message: "That workflow is not available." },
        });
        return;
      }

      const response = await executor.execute({
        operation,
        input,
        fresh: body.fresh === true,
      });
      res.status(response.status).json(response.body);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/plan", limit, async (req, res, next) => {
    try {
      if (!isPlainObject(req.body) || containsSecretField(req.body)) {
        res.status(400).json({
          ok: false,
          error: { code: "BAD_REQUEST", message: "Send favorites, a target, and an optional city. Credentials are not accepted." },
        });
        return;
      }
      const request = readPlanRequest(req.body);
      if (request.error) {
        res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: request.error } });
        return;
      }
      const response = await planRequest(request);
      res.status(response.status).json(response.body);
    } catch (error) {
      next(error);
    }
  });

  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
      res.status(400).json({
        ok: false,
        error: { code: "BAD_JSON", message: "Request body must be a JSON object under 64 KiB." },
      });
      return;
    }
    res.status(500).json({
      ok: false,
      error: { code: "INTERNAL", message: "The server could not complete the request." },
    });
  });

  return app;
}
