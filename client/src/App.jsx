import { useEffect, useState } from "react";
import { TasteInterview } from "./TasteInterview.jsx";

const FALLBACK_OPERATIONS = [
  {
    id: "find_tags",
    summary: "Search the Qloo tag ontology by concept.",
    example: { query: "sneakers", limit: 5 },
  },
];

const TARGETS = [
  { id: "place", label: "Places" },
  { id: "movie", label: "Movies" },
  { id: "brand", label: "Brands" },
  { id: "artist", label: "Artists" },
  { id: "book", label: "Books" },
];

const MODES = [
  { id: "qloo", label: "Qloo-grounded" },
  { id: "plain", label: "Plain LLM" },
  { id: "both", label: "Side by side" },
];

function formatScore(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : null;
}

function errorMessage(body, status, fallback) {
  const code = body?.error?.code;
  if (status === 429 || code === "RATE_LIMIT" || code === "QLOO_RATE_LIMIT") {
    return body?.error?.message || "The shared demo quota is busy. Wait a minute, or open a saved preset.";
  }
  if (code === "QLOO_AUTH") {
    return "Qloo rejected the server key. Saved presets still open if they were stored with the deploy.";
  }
  if (status === 502 || status === 504) {
    return body?.error?.message || "The plan request timed out or the API restarted. Try again, or open a saved preset.";
  }
  return body?.error?.message || fallback;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "BAD_RESPONSE", message: "The server returned an unreadable reply." } };
  }
}

function PlanColumn({ title, plan, pending, empty, kind }) {
  return (
    <section className="panel result" aria-live="polite">
      <div className="result-head">
        <h2>{title}</h2>
        {plan?.preset ? <span className="pill ready">Saved preset</span> : null}
        {plan && plan.grounded === false ? <span className="pill warn">Not checked</span> : null}
        {plan?.grounded && plan.explained === false ? <span className="pill">Qloo ranking</span> : null}
        {plan?.grounded && plan.explained ? <span className="pill ready">Explained</span> : null}
      </div>
      {pending ? (
        <div className="loading">
          <p>{kind === "plain" ? "Writing a comparison." : "Asking Qloo for a grounded plan."}</p>
          <p className="hint">Still working. Writing the reasons can take a little longer.</p>
        </div>
      ) : null}
      {!pending && plan ? (
        <>
          <p className="summary">{plan.summary}</p>
          {plan.grounded === false ? (
            <p className="hint">These names were not checked against Qloo. Closed or invented places can appear here.</p>
          ) : null}
          <ol className="picks">
            {plan.items.map((item) => {
              const affinity = formatScore(item.affinity);
              const popularity = formatScore(item.popularity);
              return (
                <li key={item.entity_id || item.name}>
                  <div className="pick-title">
                    <strong>{item.name}</strong>
                    {item.subtype ? <span className="pill">{String(item.subtype).replace("urn:entity:", "")}</span> : null}
                  </div>
                  {affinity || popularity ? (
                    <p className="signal">
                      Qloo signal
                      {affinity ? ` · affinity ${affinity}` : ""}
                      {popularity ? ` · popularity ${popularity}` : ""}
                    </p>
                  ) : null}
                  <p className="because">
                    Connected to {item.cited_inputs.join(", ")}
                  </p>
                  <p>{item.reason}</p>
                  {item.address ? <p className="hint">{item.address}</p> : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      {!pending && !plan ? <p className="empty">{empty}</p> : null}
    </section>
  );
}

export function App() {
  const [health, setHealth] = useState(null);
  const [presets, setPresets] = useState([]);
  const [favorites, setFavorites] = useState(["Radiohead", "Amélie", "ramen"]);
  const [target, setTarget] = useState("place");
  const [city, setCity] = useState("Lisbon");
  const [mode, setMode] = useState("qloo");
  const [qlooPending, setQlooPending] = useState(false);
  const [plainPending, setPlainPending] = useState(false);
  const [qlooPlan, setQlooPlan] = useState(null);
  const [plainPlan, setPlainPlan] = useState(null);
  const [error, setError] = useState("");

  const [operations, setOperations] = useState(FALLBACK_OPERATIONS);
  const [operation, setOperation] = useState(FALLBACK_OPERATIONS[0].id);
  const [draft, setDraft] = useState(JSON.stringify(FALLBACK_OPERATIONS[0].example, null, 2));
  const [workflowPending, setWorkflowPending] = useState(false);
  const [workflow, setWorkflow] = useState(null);
  const [workflowError, setWorkflowError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [healthResponse, operationsResponse, presetsResponse] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/operations"),
          fetch("/api/presets"),
        ]);
        if (!healthResponse.ok || !operationsResponse.ok) throw new Error("status");
        const healthBody = await healthResponse.json();
        const operationsBody = await operationsResponse.json();
        const presetsBody = presetsResponse.ok ? await presetsResponse.json() : { presets: [] };
        if (cancelled) return;
        setHealth(healthBody);
        if (Array.isArray(operationsBody.operations) && operationsBody.operations.length > 0) {
          setOperations(operationsBody.operations);
        }
        if (Array.isArray(presetsBody.presets)) setPresets(presetsBody.presets);
      } catch {
        if (!cancelled) setHealth({ ok: false, credentialConfigured: false });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function requestPlan(planMode, payload) {
    const result = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, mode: planMode }),
    });
    const body = await readJson(result);
    if (!result.ok || body.ok === false) {
      const failure = new Error(errorMessage(body, result.status, "That plan could not be built."));
      failure.code = body.error?.code;
      throw failure;
    }
    return body;
  }

  async function onPlan(event, overrides = {}) {
    event?.preventDefault();
    setError("");
    const entered = (overrides.favorites || favorites).map((item) => item.trim()).filter(Boolean);
    const nextTarget = overrides.target || target;
    const nextCity = overrides.city ?? city;
    const nextMode = overrides.mode || mode;
    if (overrides.favorites) setFavorites(overrides.favorites);
    if (overrides.target) setTarget(overrides.target);
    if (overrides.city !== undefined) setCity(overrides.city);
    if (overrides.mode) setMode(overrides.mode);
    if (entered.length < 3) {
      setError("Enter at least 3 favorites.");
      return;
    }
    if (nextMode !== "plain") {
      setQlooPlan(null);
      setQlooPending(true);
    }
    if (nextMode !== "qloo") {
      setPlainPlan(null);
      setPlainPending(true);
    }
    const payload = { favorites: entered, target: nextTarget, city: nextCity };
    const offline = "The server did not respond. On a free host the first open can take a minute while it wakes.";
    function fail(failure) {
      return failure instanceof TypeError ? offline : failure?.message || offline;
    }
    try {
      if (nextMode === "both") {
        const messages = [];
        await Promise.all([
          requestPlan("qloo", payload).then(setQlooPlan).catch((failure) => messages.push(fail(failure))).finally(() => setQlooPending(false)),
          requestPlan("plain", payload).then(setPlainPlan).catch((failure) => messages.push(fail(failure))).finally(() => setPlainPending(false)),
        ]);
        if (messages.length > 0) setError(messages.filter(Boolean).join(" "));
      } else if (nextMode === "plain") {
        setPlainPlan(await requestPlan("plain", payload));
      } else {
        setQlooPlan(await requestPlan("qloo", payload));
      }
    } catch (failure) {
      setError(fail(failure));
    } finally {
      setQlooPending(false);
      setPlainPending(false);
    }
  }

  function chooseOperation(nextId) {
    const match = operations.find((item) => item.id === nextId);
    setOperation(nextId);
    if (match) setDraft(JSON.stringify(match.example, null, 2));
    setWorkflow(null);
    setWorkflowError("");
  }

  async function onWorkflow(event) {
    event.preventDefault();
    setWorkflowError("");
    setWorkflow(null);
    let input;
    try {
      input = JSON.parse(draft);
    } catch {
      setWorkflowError("Workflow input has to be one JSON object.");
      return;
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      setWorkflowError("Workflow input has to be one JSON object.");
      return;
    }
    setWorkflowPending(true);
    try {
      const result = await fetch("/api/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, input }),
      });
      const body = await readJson(result);
      if (!result.ok || body.ok === false) {
        setWorkflowError(errorMessage(body, result.status, "That workflow failed."));
        return;
      }
      setWorkflow(body);
    } catch {
      setWorkflowError("The server did not respond. On a free host the first open can take a minute while it wakes.");
    } finally {
      setWorkflowPending(false);
    }
  }

  const credentialLabel =
    health == null ? "Checking server" : health.credentialConfigured ? "Connected" : "Credential missing";
  const selected = operations.find((item) => item.id === operation);
  const pending = qlooPending || plainPending;
  const showQloo = mode !== "plain";
  const showPlain = mode !== "qloo";

  return (
    <div className="page">
      <header className="masthead">
        <p className="mark">Taste Desk</p>
        <h1>Turn what you love into a plan.</h1>
        <p className="lede">
          Name a few favorites. Qloo ranks real picks, and each reason has to point back to one of those favorites.
        </p>
      </header>

      <main className={showQloo && showPlain ? "layout compare" : "layout"}>
        <TasteInterview
          favorites={favorites}
          setFavorites={setFavorites}
          target={target}
          setTarget={setTarget}
          city={city}
          setCity={setCity}
          mode={mode}
          setMode={setMode}
          targets={TARGETS}
          modes={MODES}
          presets={presets}
          pending={pending}
          error={error}
          health={health}
          credentialLabel={credentialLabel}
          onPlan={onPlan}
        />

        {showQloo ? (
          <PlanColumn
            title="Why these"
            plan={qlooPlan}
            kind="qloo"
            pending={qlooPending}
            empty="Each Qloo pick will show the favorites that connected to it, plus the affinity Qloo returned."
          />
        ) : null}
        {showPlain ? (
          <PlanColumn
            title="Plain model"
            plan={plainPlan}
            kind="plain"
            pending={plainPending}
            empty="A plain model answer for the same favorites. It can name places Qloo never returned."
          />
        ) : null}
      </main>

      <details className="console">
        <summary>Run a raw Qloo workflow</summary>
        <form className="panel" onSubmit={onWorkflow}>
          <label htmlFor="operation">Workflow</label>
          <select id="operation" value={operation} onChange={(event) => chooseOperation(event.target.value)}>
            {operations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
          <p className="summary">{selected?.summary}</p>
          <label htmlFor="input">Input JSON</label>
          <textarea id="input" value={draft} spellCheck="false" onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={workflowPending}>
            {workflowPending ? "Running the harness" : "Run workflow"}
          </button>
          {workflowError ? <p className="form-error">{workflowError}</p> : null}
          {workflow ? <pre>{JSON.stringify(workflow, null, 2)}</pre> : null}
        </form>
      </details>
    </div>
  );
}
