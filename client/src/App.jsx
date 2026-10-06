import { useEffect, useState } from "react";

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

export function App() {
  const [health, setHealth] = useState(null);
  const [favorites, setFavorites] = useState(["Radiohead", "Amélie", "ramen"]);
  const [target, setTarget] = useState("place");
  const [city, setCity] = useState("Lisbon");
  const [pending, setPending] = useState(false);
  const [plan, setPlan] = useState(null);
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
        const [healthResponse, operationsResponse] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/operations"),
        ]);
        if (!healthResponse.ok || !operationsResponse.ok) throw new Error("status");
        const healthBody = await healthResponse.json();
        const operationsBody = await operationsResponse.json();
        if (cancelled) return;
        setHealth(healthBody);
        if (Array.isArray(operationsBody.operations) && operationsBody.operations.length > 0) {
          setOperations(operationsBody.operations);
        }
      } catch {
        if (!cancelled) setHealth({ ok: false, credentialConfigured: false });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function updateFavorite(index, value) {
    setFavorites((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  async function onPlan(event) {
    event.preventDefault();
    setError("");
    setPlan(null);
    const entered = favorites.map((item) => item.trim()).filter(Boolean);
    if (entered.length < 3) {
      setError("Enter at least 3 favorites.");
      return;
    }
    setPending(true);
    try {
      const result = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorites: entered, target, city }),
      });
      const body = await result.json();
      if (!result.ok || body.ok === false) {
        setError(body.error?.message || "Qloo could not build that plan.");
        return;
      }
      setPlan(body);
    } catch {
      setError("The local API did not respond.");
    } finally {
      setPending(false);
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
      setWorkflow(await result.json());
    } catch {
      setWorkflowError("The local API did not respond.");
    } finally {
      setWorkflowPending(false);
    }
  }

  const credentialLabel =
    health == null ? "Checking server" : health.credentialConfigured ? "Connected" : "Credential missing";
  const selected = operations.find((item) => item.id === operation);

  return (
    <div className="page">
      <header className="masthead">
        <p className="mark">Taste Desk</p>
        <h1>Turn what you love into a plan.</h1>
        <p className="lede">
          Name a few favorites. Qloo finds related picks, and the explanation only uses those results.
        </p>
      </header>

      <main className="layout">
        <form className="panel" onSubmit={onPlan}>
          <div className="status-row">
            <span className={health?.credentialConfigured ? "pill ready" : "pill"}>{credentialLabel}</span>
            <span className="hint">Keys stay on the server.</span>
          </div>

          <label>Favorites</label>
          <div className="favorites">
            {favorites.map((favorite, index) => (
              <input
                key={index}
                aria-label={`Favorite ${index + 1}`}
                value={favorite}
                onChange={(event) => updateFavorite(index, event.target.value)}
                placeholder="A band, film, dish, or brand"
              />
            ))}
          </div>
          {favorites.length < 5 ? (
            <button type="button" className="text-button" onClick={() => setFavorites((current) => [...current, ""])}>
              Add another
            </button>
          ) : null}

          <label htmlFor="target">Looking for</label>
          <select id="target" value={target} onChange={(event) => setTarget(event.target.value)}>
            {TARGETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>

          <label htmlFor="city">City</label>
          <input id="city" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Optional, used for places" />

          <button type="submit" disabled={pending}>
            {pending ? "Asking Qloo" : "Build the plan"}
          </button>
          <p className="hint wait-note">The first plan can take a couple of minutes.</p>
          {error ? <p className="form-error">{error}</p> : null}
        </form>

        <section className="panel result" aria-live="polite">
          <div className="result-head">
            <h2>Plan</h2>
            {plan?.explained === false ? <span className="pill">Qloo ranking</span> : null}
            {plan?.explained ? <span className="pill ready">Explained</span> : null}
          </div>
          {plan ? (
            <>
              <p className="summary">{plan.summary}</p>
              <ol className="picks">
                {plan.items.map((item) => (
                  <li key={item.entity_id || item.name}>
                    <strong>{item.name}</strong>
                    <p>{item.reason}</p>
                    <div className="status-row">
                      {item.cited_inputs.map((input) => (
                        <span className="pill" key={input}>
                          {input}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="empty">Your plan will list Qloo picks and the favorites that led to each one.</p>
          )}
        </section>
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
