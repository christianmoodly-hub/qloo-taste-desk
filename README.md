# Taste Desk

A small hackathon app that turns a few favorites into a Qloo-backed plan. The browser never sees the Qloo or Gemini credentials. An Express server reads them from its environment, runs `qloo exec`, and asks Gemini only to explain items Qloo returned.

The workspace did not include a `starter/cli-workflow` guide. Workflow calls follow the non-interactive contract in `@qloo/qloo-harness` 0.1.26.

## Layout

- `server/` — Express API. Spawns the harness with `shell: false`, caches successful results, and retries only failures the harness marks retryable, at most three times.
- `client/` — Vite + React. The main form calls `/api/plan`. A collapsed panel still calls `/api/exec`.
- `scripts/probe.js` — saves one real `find_tags`, `describe`, and `recommend` response under `docs/samples/`.
- `.env.example` — empty placeholders. Real keys belong in `.env`, which is gitignored.

## Setup

Node.js 22.19 or newer is required by the harness.

```sh
npm install
copy .env.example .env
```

Edit `.env` and set `QLOO_API_KEY` and `GEMINI_API_KEY`. A hackathon key also needs `QLOO_BASE_URL` and `QLOO_TRUSTED_BASE_URL` set to `https://hackathon.api.qloo.com`. Leave `.env` out of git.

```sh
npm test
npm run probe
npm run dev
```

The API listens on `http://127.0.0.1:8787`. The page is at `http://localhost:5173` and proxies `/api` to that server. The status pill says Connected when the Qloo key is set.

`POST /api/plan` accepts 3 to 5 favorites, a target (`place`, `movie`, `brand`, `artist`, or `book`), and an optional city. It resolves each favorite with `describe`, calls `recommend`, then asks Gemini for a JSON itinerary. Any item the model names that Qloo did not return is dropped. `/api/exec` and `/api/plan` share a limit of 20 requests per minute per IP.

## Deploy

[render.yaml](render.yaml) describes one web service. Set `QLOO_API_KEY` and `GEMINI_API_KEY` in the Render dashboard. Do not commit them. The service builds the client and serves it from the API process. `HOST` is `0.0.0.0` there so the platform can reach the port it assigns.
