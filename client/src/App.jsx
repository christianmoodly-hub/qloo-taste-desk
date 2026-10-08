import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { AccountPanel, accountInitials } from "./AccountPanel.jsx";
import { auth, loadCloudDesk, saveCloudDesk } from "./firebase.js";
import { CityMood } from "./CityMood.jsx";
import { HomeDesk } from "./HomeDesk.jsx";
import { JourneyMap } from "./JourneyMap.jsx";
import { TasteMap, TasteTags } from "./TasteMap.jsx";

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

const DESK_DEFAULTS = {
  favorites: ["Radiohead", "Amélie", "ramen"],
  target: "place",
  city: "Lisbon",
  mode: "qloo",
};

function deskKey(uid) {
  return `taste-desk:${uid}`;
}

function readDesk(uid) {
  try {
    const parsed = JSON.parse(localStorage.getItem(deskKey(uid)) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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

function subtypeLabel(value) {
  return String(value || "").replace(/^urn:entity:/, "").replaceAll("_", " ");
}

function affinityPercent(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 100) : null;
}

function favoritePhrase(favorites) {
  const names = favorites.filter(Boolean);
  if (names.length === 0) return "your favorites";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function radarValues(favorites, items) {
  const labels = favorites.filter(Boolean).slice(0, 5);
  const usable = labels.length >= 3 ? labels : ["Taste", "Place", "Mood"];
  return usable.map((label) => {
    const cited = (items || []).filter((item) =>
      (item.cited_inputs || []).some((input) => input.toLowerCase() === label.toLowerCase()),
    );
    if (cited.length === 0) return { label, value: 0.55 };
    const total = cited.reduce((sum, item) => sum + (typeof item.affinity === "number" ? item.affinity : 0.7), 0);
    return { label, value: Math.min(1, Math.max(0.2, total / cited.length)) };
  });
}

function Radar({ points }) {
  const cx = 140;
  const cy = 132;
  const radius = 72;
  const count = points.length;
  const at = (index, scale) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [cx + Math.cos(angle) * radius * scale, cy + Math.sin(angle) * radius * scale];
  };
  const ring = (scale) => points.map((_, index) => at(index, scale).join(",")).join(" ");
  const shape = points.map((point, index) => at(index, point.value).join(",")).join(" ");
  return (
    <svg className="radar" viewBox="0 0 280 250" role="img" aria-label="Taste radar">
      {[1, 0.66, 0.33].map((scale) => (
        <polygon key={scale} points={ring(scale)} />
      ))}
      {points.map((_, index) => {
        const [x, y] = at(index, 1);
        return <line key={index} x1={cx} y1={cy} x2={x} y2={y} />;
      })}
      <polygon className="radar-shape" points={shape} />
      {points.map((point, index) => {
        const [x, y] = at(index, point.value);
        const [lx, ly] = at(index, 1.38);
        const anchor = lx < cx - 12 ? "end" : lx > cx + 12 ? "start" : "middle";
        return (
          <g key={point.label}>
            <circle cx={x} cy={y} r="3.5" />
            <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle">{point.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function photoTone(name) {
  const tones = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
  const index = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[index % tones.length];
}

function qlooImageUrl(entityId) {
  const id = String(entityId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return `https://images.qloo.com/i/${id.toUpperCase()}-420x-auto.jpg`;
}

function VenueCard({ item, city }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = qlooImageUrl(item.entity_id);
  const percent = affinityPercent(item.affinity);
  const tags = [...new Set([...(item.cited_inputs || []), subtypeLabel(item.subtype), city].filter(Boolean))].slice(0, 3);
  return (
    <article className="venue">
      <div className={`venue-photo ${photoTone(item.name)}`}>
        {photo && !photoFailed ? (
          <img
            src={photo}
            alt=""
            onError={() => setPhotoFailed(true)}
            onLoad={(event) => {
              if (event.currentTarget.naturalWidth < 80) setPhotoFailed(true);
            }}
          />
        ) : (
          <span aria-hidden="true">{item.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="venue-copy">
        <h3>{item.name}</h3>
        <p className="venue-lead">{item.address || `Connected to ${(item.cited_inputs || []).join(", ")}.`}</p>
        <div className="tag-row">
          {tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
        <p className="why-label">Why this fits</p>
        <p>{item.reason}</p>
        {percent != null ? (
          <div className="affinity">
            <span>Affinity</span>
            <span className="affinity-track"><span style={{ width: `${percent}%` }} /></span>
            <strong>{percent}</strong>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function App() {
  const [health, setHealth] = useState(null);
  const [presets, setPresets] = useState([]);
  const [favorites, setFavorites] = useState(DESK_DEFAULTS.favorites);
  const [target, setTarget] = useState(DESK_DEFAULTS.target);
  const [city, setCity] = useState(DESK_DEFAULTS.city);
  const [mode, setMode] = useState(DESK_DEFAULTS.mode);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [deskUid, setDeskUid] = useState(null);
  const [syncNote, setSyncNote] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
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
  const [composerOpen, setComposerOpen] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (next) => {
    setUser(next);
    setAuthReady(true);
    if (next) setAccountOpen(false);
  }), []);

  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    if (!user) {
      setDeskUid(null);
      setFavorites(DESK_DEFAULTS.favorites);
      setTarget(DESK_DEFAULTS.target);
      setCity(DESK_DEFAULTS.city);
      setMode(DESK_DEFAULTS.mode);
      setQlooPlan(null);
      setPlainPlan(null);
      setError("");
      setSyncNote("");
      setComposerOpen(true);
      return undefined;
    }
    async function restore() {
      let saved = null;
      try {
        saved = await loadCloudDesk(user.uid);
      } catch {
        saved = null;
      }
      if (!saved) saved = readDesk(user.uid);
      if (cancelled) return;
      if (saved) {
        if (Array.isArray(saved.favorites) && saved.favorites.length >= 3) setFavorites(saved.favorites);
        if (typeof saved.target === "string") setTarget(saved.target);
        if (typeof saved.city === "string") setCity(saved.city);
        if (saved.mode === "qloo" || saved.mode === "plain" || saved.mode === "both") setMode(saved.mode);
        if (saved.qlooPlan) setQlooPlan(saved.qlooPlan);
        if (saved.plainPlan) setPlainPlan(saved.plainPlan);
        if (saved.qlooPlan || saved.plainPlan) setComposerOpen(false);
      }
      setDeskUid(user.uid);
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, [authReady, user?.uid]);

  useEffect(() => {
    if (!user || deskUid !== user.uid) return undefined;
    const desk = { favorites, target, city, mode, qlooPlan, plainPlan };
    try {
      localStorage.setItem(deskKey(user.uid), JSON.stringify(desk));
    } catch {
      // A private browser can refuse storage. Firestore still keeps the desk.
    }
    const timer = setTimeout(() => {
      saveCloudDesk(user.uid, desk).then(() => {
        setSyncNote("");
      }).catch((failure) => {
        if (failure?.code === "permission-denied") {
          setSyncNote("This account cannot save to Firestore yet. In the Firebase console, allow a signed-in user to read and write only their own desks document.");
        }
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [user, deskUid, favorites, target, city, mode, qlooPlan, plainPlan]);

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
        else setComposerOpen(false);
      } else if (nextMode === "plain") {
        setPlainPlan(await requestPlan("plain", payload));
        setComposerOpen(false);
      } else {
        setQlooPlan(await requestPlan("qloo", payload));
        setComposerOpen(false);
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
  const storyPlan = qlooPlan || plainPlan;
  const showHome = !storyPlan || composerOpen;
  const nightLabel = target === "place" ? "night" : target;
  const radar = radarValues(favorites, qlooPlan?.items || []);
  const trace = Array.isArray(qlooPlan?.trace) ? qlooPlan.trace : [];

  function showHomeScreen() {
    setComposerOpen(true);
    document.getElementById("plan")?.scrollIntoView({ behavior: "smooth" });
  }

  function showExamples(event) {
    event.preventDefault();
    setComposerOpen(true);
    window.setTimeout(() => {
      document.getElementById("examples")?.scrollIntoView({ behavior: "smooth" });
    }, 40);
  }

  return (
    <div className="desk">
      <header className="topbar">
        <a className="brand" href="#plan" onClick={showHomeScreen}>
          <span className="mark">T</span>
          <span className="brand-name">Taste Desk</span>
        </a>
        <span className="brand-rule" aria-hidden="true" />
        <p className="brand-tag">Your taste, translated for a new city</p>
        <span className={health?.credentialConfigured ? "live-pill on" : "live-pill"}>{credentialLabel}</span>
        <nav>
          <button type="button" className={showHome ? "nav-link current" : "nav-link"} onClick={showHomeScreen}>Home</button>
          <button type="button" className="nav-link" onClick={showExamples}>Examples</button>
          <a className="nav-link" href="#about">About</a>
          <a className="nav-link" href="https://github.com/christianmoodly-hub/qloo-taste-desk" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <div className="account-slot">
          <button
            type="button"
            className="avatar"
            aria-expanded={accountOpen}
            aria-controls="account-menu"
            onClick={() => setAccountOpen((open) => !open)}
          >
            {user ? accountInitials(user) : "in"}
          </button>
          {accountOpen ? (
            <div className="account-menu" id="account-menu">
              <AccountPanel user={user} id="account-menu-panel" onSession={() => setUser(auth.currentUser)} />
            </div>
          ) : null}
        </div>
      </header>

      <main id="plan">
        {syncNote ? <p className="form-error">{syncNote}</p> : null}
        {showHome ? (
          <HomeDesk
            favorites={favorites}
            setFavorites={setFavorites}
            target={target}
            city={city}
            setCity={setCity}
            presets={presets}
            pending={pending}
            error={error}
            onPlan={onPlan}
          />
        ) : (
          <>
        <p className="eyebrow">Results based on Taste Desk · Your taste, translated into a new city</p>
        <h1>
          Your {city.trim() || "next"} {nightLabel}, based on <em>{favoritePhrase(favorites)}</em>.
        </h1>
        <p className="lede">
          {storyPlan?.summary || "Name a few favorites. Qloo ranks real picks, and each reason has to point back to one of those favorites."}
        </p>
        <div className="hero-row">
          <div className="tag-row">
            {qlooPlan?.grounded ? <span className="tag solid">Grounded in Qloo</span> : null}
            {plainPlan && !qlooPlan ? <span className="tag warn">Not checked</span> : null}
            {city.trim() ? <span className="tag">{city.trim()}</span> : null}
            <span className="tag">{TARGETS.find((item) => item.id === target)?.label}</span>
          </div>
          {user ? (
            <button type="button" className="edit-tastes" onClick={() => setComposerOpen(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 16.5V20h3.5L18.8 8.7l-3.5-3.5L4 16.5z" />
                <path d="M14.2 6.3l3.5 3.5" />
              </svg>
              Edit tastes
            </button>
          ) : null}
        </div>
        <CityMood city={city} />
        {qlooPlan?.taste_map?.favorites?.length ? <TasteMap tasteMap={qlooPlan.taste_map} /> : null}
        {qlooPlan?.taste_tags?.favorites?.length ? <TasteTags tasteTags={qlooPlan.taste_tags} /> : null}

        <div className={qlooPlan ? "results" : "results single"}>
          <section className="venues" aria-live="polite">
            {qlooPending ? <p className="loading">Asking Qloo for a grounded plan. Writing the reasons can take a little longer.</p> : null}
            {showQloo && qlooPlan ? qlooPlan.items.map((item) => (
              <VenueCard key={item.entity_id || item.name} item={item} city={city.trim()} />
            )) : null}
            {showPlain ? (
              <section className="plain-block">
                <div className="result-head">
                  <h2>Plain model</h2>
                  <span className="tag warn">Not checked</span>
                </div>
                {plainPending ? <p className="loading">Writing a comparison.</p> : null}
                {plainPlan ? (
                  <>
                    <p className="hint">These names were not checked against Qloo. Closed or invented places can appear here.</p>
                    {plainPlan.items.map((item) => (
                      <article key={item.name} className="venue plain-venue">
                        <div className="venue-copy">
                          <h3>{item.name}</h3>
                          <p className="because">Connected to {(item.cited_inputs || favorites).join(", ")}</p>
                          <p>{item.reason}</p>
                        </div>
                      </article>
                    ))}
                  </>
                ) : null}
              </section>
            ) : null}
          </section>

          {qlooPlan ? (
            <aside className="sidebar" id="method">
              <section className="side-card">
                <h2>Journey radar</h2>
                <JourneyMap items={qlooPlan.items} city={city.trim()} />
                <ol className="stops">
                  {qlooPlan.items.map((item, index) => (
                    <li key={item.entity_id || item.name}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{item.name}</strong>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="side-card">
                <h2>Journey progression</h2>
                <Radar points={radar} />
              </section>
              <section className="side-card rationale">
                <h2>Curator's rationale</h2>
                <p>{qlooPlan.summary}</p>
              </section>
            </aside>
          ) : null}
        </div>

        {trace.length > 0 ? (
          <section className="decided">
            <h2>How the Taste Agent Decided</h2>
            <ul className="trace">
              {trace.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
          </>
        )}
      </main>

      <footer className="site-footer" id="about">
        <div>
          <strong>Taste Desk</strong>
          <p>Powered by Qloo’s taste graph. Results reflect aggregate taste patterns, not claims about any individual.</p>
        </div>
        <nav>
          <a href="#about">About</a>
          <a href="https://github.com/christianmoodly-hub/qloo-taste-desk" target="_blank" rel="noreferrer">GitHub</a>
          <span>© 2026 Taste Desk</span>
        </nav>
      </footer>

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
          <button type="submit" className="cta" disabled={workflowPending}>
            {workflowPending ? "Running the harness" : "Run workflow"}
          </button>
          {workflowError ? <p className="form-error">{workflowError}</p> : null}
          {workflow ? <pre>{JSON.stringify(workflow, null, 2)}</pre> : null}
        </form>
      </details>
    </div>
  );
}
