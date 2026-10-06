import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { createCache } from "../src/cache.js";
import { redactSecrets } from "../src/env.js";
import { buildChildEnv, buildExecArgs, createExecutor, isRetryable, runQlooProcess } from "../src/qlooExec.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function successRun(result) {
  return { exitCode: 0, stdout: JSON.stringify(result), stderr: "", timedOut: false, truncated: false };
}

test("child env keeps the server Qloo credential and drops unrelated secrets", () => {
  const env = buildChildEnv({
    PATH: "C:\\Windows",
    QLOO_API_KEY: "server-key",
    GEMINI_API_KEY: "gem-key",
    AWS_SECRET_ACCESS_KEY: "nope",
    NPM_TOKEN: "nope",
  });
  assert.equal(env.QLOO_API_KEY, "server-key");
  assert.equal(env.PATH, "C:\\Windows");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.NPM_TOKEN, undefined);
  assert.equal(env.GEMINI_API_KEY, undefined);
});

test("exec argv is the harness bin plus a single allowlisted operation", () => {
  assert.deepEqual(buildExecArgs("/opt/qloo/bin.js", "find_tags"), ["/opt/qloo/bin.js", "exec", "find_tags"]);
  assert.throws(() => buildExecArgs("/opt/qloo/bin.js", "find_tags; rm -rf /"));
});

test("redacts the server credential if a child echoes it", () => {
  const text = redactSecrets("failed with key server-key and gem-key", {
    QLOO_API_KEY: "server-key",
    GEMINI_API_KEY: "gem-key",
  });
  assert.equal(text.includes("server-key"), false);
  assert.equal(text.includes("gem-key"), false);
  assert.match(text, /\[redacted\]/);
});

test("retries only bounded retryable failures", async () => {
  const calls = [];
  const executor = createExecutor({
    maxAttempts: 3,
    backoffMs: () => 0,
    cache: createCache(),
    run: async (operation) => {
      calls.push(operation);
      if (calls.length < 3) {
        return {
          exitCode: 1,
          stdout: JSON.stringify({ error: { code: "UPSTREAM", retryable: true } }),
          stderr: "",
          timedOut: false,
          truncated: false,
        };
      }
      return successRun({ status: "ok", result_count: 1 });
    },
  });

  const response = await executor.execute({
    operation: "find_tags",
    input: { query: "sneakers", limit: 1 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.attempts, 3);
  assert.equal(response.body.cached, false);
  assert.equal(calls.length, 3);

  const again = await executor.execute({
    operation: "find_tags",
    input: { limit: 1, query: "sneakers" },
  });
  assert.equal(again.body.cached, true);
  assert.equal(calls.length, 3);
});

test("does not retry auth or usage failures", async () => {
  for (const exitCode of [2, 4, 130]) {
    let calls = 0;
    const executor = createExecutor({
      maxAttempts: 3,
      backoffMs: () => 0,
      run: async () => {
        calls += 1;
        return {
          exitCode,
          stdout: JSON.stringify({ error: { code: exitCode === 4 ? "QLOO_AUTH" : "TOOL_INPUT", retryable: false } }),
          stderr: "",
          timedOut: false,
          truncated: false,
        };
      },
    });
    const response = await executor.execute({ operation: "describe", input: { entity: "Nike" } });
    assert.equal(calls, 1);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.attempts, 1);
  }
});

test("stops at the attempt cap when every failure is retryable", async () => {
  let calls = 0;
  const executor = createExecutor({
    maxAttempts: 3,
    backoffMs: () => 0,
    run: async () => {
      calls += 1;
      return { exitCode: null, stdout: "", stderr: "", timedOut: true, truncated: false };
    },
  });
  const response = await executor.execute({ operation: "trends", input: { entities: ["Nike"] } });
  assert.equal(calls, 3);
  assert.equal(response.status, 504);
  assert.equal(response.body.attempts, 3);
});

test("isRetryable follows the harness exit codes", () => {
  assert.equal(isRetryable({ exitCode: 1, json: { error: { retryable: true } } }), true);
  assert.equal(isRetryable({ exitCode: 1, json: { error: { retryable: false } } }), false);
  assert.equal(isRetryable({ exitCode: 4, json: { error: { retryable: true } } }), false);
  assert.equal(isRetryable({ timedOut: true }), true);
  assert.equal(isRetryable({ spawnError: { code: "ENOENT" } }), false);
});

test("HTTP endpoint rejects credentials and unknown workflows", async () => {
  const calls = [];
  const app = createApp({
    execute: async (request) => {
      calls.push(request);
      return { status: 200, body: { ok: true, result: { status: "ok" } } };
    },
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const secret = await fetch(`${base}/api/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "find_tags", input: { query: "a" }, apiKey: "leak" }),
    });
    assert.equal(secret.status, 400);
    assert.equal(calls.length, 0);

    const unknown = await fetch(`${base}/api/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "shell", input: { query: "a" } }),
    });
    assert.equal(unknown.status, 400);
    assert.equal(calls.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("qloo exec reports missing auth without a credential", { timeout: 60_000 }, async () => {
  const previous = process.env.QLOO_API_KEY;
  delete process.env.QLOO_API_KEY;
  try {
    const run = await runQlooProcess("find_tags", JSON.stringify({ query: "sneakers", limit: 1 }), {
      env: buildChildEnv(process.env),
      timeoutMs: 45_000,
    });
    assert.equal(run.exitCode, 4);
    assert.equal(run.stdout.includes("QLOO_API_KEY="), false);
    const body = JSON.parse(run.stdout);
    assert.equal(body.error.code, "QLOO_AUTH");
  } finally {
    if (previous === undefined) delete process.env.QLOO_API_KEY;
    else process.env.QLOO_API_KEY = previous;
  }
});

test("client source and example env do not carry a Qloo credential", async () => {
  const example = await readFile(path.join(root, ".env.example"), "utf8");
  assert.match(example, /^QLOO_API_KEY=\s*$/m);
  assert.match(example, /^GEMINI_API_KEY=\s*$/m);
  assert.equal(example.includes("hack_"), false);
  assert.equal(example.includes("AQ."), false);

  const clientSrc = path.join(root, "client", "src");
  const files = await readdir(clientSrc);
  for (const file of files) {
    const text = await readFile(path.join(clientSrc, file), "utf8");
    assert.equal(text.includes("QLOO_API_KEY"), false);
    assert.equal(text.includes("VITE_"), false);
  }
});
