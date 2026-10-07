import { createApp } from "./app.js";
import { credentialConfigured, loadEnv } from "./env.js";

loadEnv();

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const app = createApp();

app.listen(port, host, () => {
  const credential = credentialConfigured() ? "configured" : "missing";
  console.log(`Taste Desk API listening on http://${host}:${port} (Qloo credential ${credential})`);
});
