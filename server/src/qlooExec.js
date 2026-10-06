import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCache } from "./cache.js";
import { redactSecrets } from "./env.js";
import { OPERATION_IDS, canonicalize } from "./operations.js";

const MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

const ENV_PASSTHROUGH = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
];

const QLOO_SERVER_KEYS = ["QLOO_API_KEY", "QLOO_BASE_URL", "QLOO_TRUSTED_BASE_URL", "QLOO_HOME"];

export function buildChildEnv(source = process.env) {
  const env = {};
  for (const key of ENV_PASSTHROUGH) {
    if (typeof source[key] === "string") env[key] = source[key];
  }
  for (const key of QLOO_SERVER_KEYS) {
    if (typeof source[key] === "string" && source[key].length > 0) env[key] = source[key];
  }
  return env;
}

export function buildExecArgs(binPath, operation) {
  if (!OPERATION_IDS.has(operation)) {
    throw new Error(`unknown workflow operation: ${operation}`);
  }
  return [binPath, "exec", operation];
}

function qlooBinPath() {
  const packageEntry = fileURLToPath(import.meta.resolve("@qloo/qloo-harness"));
  return path.join(path.dirname(packageEntry), "bin.js");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runQlooProcess(operation, inputJson, options = {}) {
  const env = options.env ?? buildChildEnv();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const binPath = options.binPath ?? qlooBinPath();
  const args = buildExecArgs(binPath, operation);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, args, {
        shell: false,
        windowsHide: true,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        exitCode: null,
        spawnError: error,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        exitCode: null,
        stdout: redactSecrets(stdout, env),
        stderr: redactSecrets(stderr, env),
        timedOut: true,
        truncated,
      });
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += chunk;
      if (stdout.length >= MAX_STDOUT_BYTES) truncated = true;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk;
    });
    child.on("error", (error) => {
      finish({
        exitCode: null,
        spawnError: error,
        stdout: redactSecrets(stdout, env),
        stderr: redactSecrets(stderr, env),
        timedOut: false,
        truncated,
      });
    });
    child.on("close", (exitCode) => {
      finish({
        exitCode,
        stdout: redactSecrets(stdout, env),
        stderr: redactSecrets(stderr, env),
        timedOut: false,
        truncated,
      });
    });

    child.stdin.on("error", () => {});
    child.stdin.write(inputJson);
    child.stdin.end();
  });
}

function parseStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function isRetryable(run) {
  if (!run || run.truncated) return false;
  if (run.timedOut) return true;
  if (run.spawnError) return run.spawnError.code !== "ENOENT";
  if (run.exitCode === 0 || run.exitCode === 2 || run.exitCode === 4 || run.exitCode === 130) return false;
  if (run.exitCode === 1) return run.json?.error?.retryable === true;
  return false;
}

function httpStatus(run) {
  if (run?.timedOut) return 504;
  if (run?.exitCode === 2) return 400;
  if (run?.exitCode === 4) return 503;
  if (run?.exitCode === 130) return 499;
  return 502;
}

function errorMessage(run) {
  if (run?.timedOut) return "The Qloo workflow timed out.";
  if (run?.truncated) return "The Qloo workflow returned more output than this server accepts.";
  if (run?.spawnError) return "The Qloo executable could not be started.";
  if (run?.json?.error?.code === "QLOO_AUTH") {
    return "Qloo rejected the server credential. Check the server environment and gateway.";
  }
  if (typeof run?.json?.error?.code === "string") {
    return `Qloo workflow failed (${run.json.error.code}).`;
  }
  const stderr = run?.stderr?.trim();
  if (stderr) return stderr.split("\n")[0].slice(0, 300);
  return "Qloo workflow failed.";
}

export function createExecutor(options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? ((attempt) => 150 * attempt);
  const cache = options.cache ?? createCache(options.cacheOptions);
  const run = options.run ?? runQlooProcess;
  const inflight = new Map();

  async function execute({ operation, input, fresh = false }) {
    if (!OPERATION_IDS.has(operation)) {
      return {
        status: 400,
        body: {
          ok: false,
          error: { code: "UNKNOWN_OPERATION", message: "That workflow is not available." },
        },
      };
    }

    const canonical = canonicalize(input);
    const inputJson = JSON.stringify(canonical);
    if (Buffer.byteLength(inputJson) > MAX_INPUT_BYTES) {
      return {
        status: 400,
        body: {
          ok: false,
          operation,
          error: { code: "INPUT_TOO_LARGE", message: "Workflow input exceeds 64 KiB." },
        },
      };
    }

    const cacheKey = `${operation}:${inputJson}`;
    if (!fresh) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return { status: 200, body: { ...cached, cached: true, attempts: 0 } };
      }
    }

    const existing = inflight.get(cacheKey);
    if (existing) return existing;

    const promise = runWithRetries(operation, inputJson, cacheKey);
    inflight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function runWithRetries(operation, inputJson, cacheKey) {
    let last;
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const raw = await run(operation, inputJson, { attempt });
      last = { ...raw, json: parseStdout(raw.stdout ?? "") };
      if (last.exitCode === 0 && last.json && !last.json.error) {
        const stored = { ok: true, operation, result: last.json };
        cache.set(cacheKey, stored);
        return {
          status: 200,
          body: { ...stored, cached: false, attempts },
        };
      }
      if (!isRetryable(last) || attempt === maxAttempts) break;
      await sleep(backoffMs(attempt));
    }

    return {
      status: httpStatus(last),
      body: {
        ok: false,
        operation,
        cached: false,
        attempts,
        error: {
          code: last?.json?.error?.code ?? (last?.timedOut ? "TIMEOUT" : "QLOO_EXEC_FAILED"),
          retryable: false,
          message: errorMessage(last),
        },
      },
    };
  }

  return { execute, cache };
}
