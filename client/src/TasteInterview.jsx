import { useEffect, useId, useRef, useState } from "react";

const STEPS = [
  { id: "favorites", label: "Favorites" },
  { id: "target", label: "Looking for" },
  { id: "city", label: "City" },
  { id: "mode", label: "Answer" },
  { id: "review", label: "Review" },
];

const SUGGESTIONS = ["Radiohead", "Amélie", "ramen", "Nike", "Studio Ghibli", "espresso"];

const TARGET_HINTS = {
  place: "Neighborhoods, rooms, tables",
  movie: "Films that rhyme with your taste",
  brand: "Labels next to what you already love",
  artist: "Acts adjacent to your favorites",
  book: "Pages that echo your shelf",
};

const MODE_HINTS = {
  qloo: "Ranked against real cultural signals",
  plain: "A model answer with no Qloo check",
  both: "Compare grounded picks with a plain reply",
};

export function TasteInterview({
  favorites,
  setFavorites,
  target,
  setTarget,
  city,
  setCity,
  mode,
  setMode,
  targets,
  modes,
  presets,
  pending,
  error,
  health,
  credentialLabel,
  onPlan,
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState("");
  const [direction, setDirection] = useState(1);
  const [chipAnim, setChipAnim] = useState(null);
  const questionRef = useRef(null);
  const inputRef = useRef(null);
  const progressId = useId();

  const cleanFavorites = favorites.map((item) => item.trim()).filter(Boolean);
  const canContinueFavorites = cleanFavorites.length >= 3;
  const stepMeta = STEPS[step];
  const progress = ((step + 1) / STEPS.length) * 100;

  useEffect(() => {
    const node = questionRef.current;
    if (!node) return;
    node.focus();
  }, [step]);

  useEffect(() => {
    if (step === 0) inputRef.current?.focus();
  }, [step]);

  function goTo(next) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function addFavorite(raw) {
    const value = String(raw || "").trim();
    if (!value) return;
    const exists = favorites.some((item) => item.trim().toLowerCase() === value.toLowerCase());
    if (exists) {
      setDraft("");
      return;
    }
    if (cleanFavorites.length >= 5) return;
    setFavorites((current) => {
      const next = [...current.map((item) => item.trim()).filter(Boolean), value];
      return next.slice(0, 5);
    });
    setChipAnim(value);
    setDraft("");
    window.setTimeout(() => setChipAnim(null), 420);
  }

  function removeFavorite(value) {
    setFavorites((current) => current.filter((item) => item !== value));
  }

  function onFavoriteKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      addFavorite(draft);
    }
  }

  function onFormSubmit(event) {
    event.preventDefault();
    if (step < STEPS.length - 1) {
      if (step === 0) {
        if (draft.trim()) {
          addFavorite(draft);
          return;
        }
        if (!canContinueFavorites) return;
      }
      goTo(step + 1);
      return;
    }
    onPlan(event);
  }

  const targetLabel = targets.find((item) => item.id === target)?.label || target;
  const modeLabel = modes.find((item) => item.id === mode)?.label || mode;

  return (
    <form className="panel interview" onSubmit={onFormSubmit}>
      <div className="status-row">
        <span className={health?.credentialConfigured ? "pill ready" : "pill"}>{credentialLabel}</span>
        <span className="hint">Keys stay on the server.</span>
      </div>

      <div
        className="interview-progress"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={step + 1}
        aria-valuetext={`Step ${step + 1} of ${STEPS.length}: ${stepMeta.label}`}
        aria-labelledby={progressId}
      >
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <ol className="step-dots" id={progressId}>
          {STEPS.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={
                  index === step ? "step-dot current" : index < step ? "step-dot done" : "step-dot"
                }
                aria-current={index === step ? "step" : undefined}
                aria-label={`${item.label}${index < step ? ", completed" : index === step ? ", current" : ""}`}
                onClick={() => {
                  if (index <= step) goTo(index);
                }}
                disabled={index > step}
              />
            </li>
          ))}
        </ol>
      </div>

      <div
        key={stepMeta.id}
        className={`interview-step enter-${direction > 0 ? "forward" : "back"}`}
        aria-labelledby="interview-question"
      >
        {step === 0 ? (
          <>
            <p className="step-kicker">Step 1 · Taste</p>
            <h2 id="interview-question" className="interview-question" tabIndex={-1} ref={questionRef}>
              What do you love?
            </h2>
            <p className="interview-help">Add 3 to 5 favorites. One big answer at a time.</p>

            {presets.length > 0 ? (
              <div className="demo-skip">
                <p className="hint">Skip to a demo</p>
                <div className="status-row">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="preset"
                      onClick={() => onPlan(null, { ...preset, mode: "qloo" })}
                      disabled={pending}
                    >
                      {preset.label}
                      {preset.ready ? " · instant" : ""}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="favorite-entry">
              <input
                ref={inputRef}
                aria-label="Add a favorite"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onFavoriteKeyDown}
                placeholder="A band, film, dish, or brand"
                disabled={cleanFavorites.length >= 5}
              />
              <button
                type="button"
                className="add-chip"
                onClick={() => addFavorite(draft)}
                disabled={!draft.trim() || cleanFavorites.length >= 5}
              >
                Add
              </button>
            </div>

            <div className="suggest-row" aria-label="Suggested favorites">
              {SUGGESTIONS.map((item) => {
                const taken = cleanFavorites.some((fav) => fav.toLowerCase() === item.toLowerCase());
                return (
                  <button
                    key={item}
                    type="button"
                    className={taken ? "suggest taken" : "suggest"}
                    onClick={() => addFavorite(item)}
                    disabled={taken || cleanFavorites.length >= 5}
                  >
                    {item}
                  </button>
                );
              })}
            </div>

            <div className="taste-trail" aria-live="polite">
              <div className="trail-meta">
                <span className="hint">{cleanFavorites.length} of 3+</span>
              </div>
              <ul className="taste-chips">
                {cleanFavorites.map((item) => (
                  <li key={item}>
                    <button
                      type="button"
                      className={chipAnim === item ? "taste-chip pop" : "taste-chip"}
                      onClick={() => removeFavorite(item)}
                      aria-label={`Remove ${item}`}
                    >
                      {item}
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="step-kicker">Step 2 · Destination</p>
            <h2 id="interview-question" className="interview-question" tabIndex={-1} ref={questionRef}>
              Where should taste take you?
            </h2>
            <p className="interview-help">Pick one lane for this plan.</p>
            <div className="choice-grid" role="radiogroup" aria-label="Looking for">
              {targets.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={target === item.id}
                  className={target === item.id ? "choice-tile selected" : "choice-tile"}
                  onClick={() => setTarget(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span>{TARGET_HINTS[item.id]}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="step-kicker">Step 3 · Place</p>
            <h2 id="interview-question" className="interview-question" tabIndex={-1} ref={questionRef}>
              Any city in mind?
            </h2>
            <p className="interview-help">
              {target === "place"
                ? "Optional, but helpful when you want places nearby."
                : "Optional — mostly used when looking for places."}
            </p>
            <input
              id="city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Lisbon, Tokyo, Brooklyn…"
              aria-label="City"
            />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="step-kicker">Step 4 · Voice</p>
            <h2 id="interview-question" className="interview-question" tabIndex={-1} ref={questionRef}>
              How do you want the answer?
            </h2>
            <p className="interview-help">Choose how the plan is written.</p>
            <div className="choice-grid modes-grid" role="radiogroup" aria-label="Answer source">
              {modes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === item.id}
                  className={mode === item.id ? "choice-tile selected" : "choice-tile"}
                  onClick={() => setMode(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span>{MODE_HINTS[item.id]}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <p className="step-kicker">Step 5 · Review</p>
            <h2 id="interview-question" className="interview-question" tabIndex={-1} ref={questionRef}>
              Ready to build?
            </h2>
            <p className="interview-help">A quick check before Qloo ranks the plan.</p>

            <dl className="review-summary">
              <div>
                <dt>Favorites</dt>
                <dd>
                  <ul className="taste-chips review-chips">
                    {cleanFavorites.map((item) => (
                      <li key={item}>
                        <span className="taste-chip static">{item}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt>Looking for</dt>
                <dd>{targetLabel}</dd>
              </div>
              <div>
                <dt>City</dt>
                <dd>{city.trim() || "Anywhere"}</dd>
              </div>
              <div>
                <dt>Answer</dt>
                <dd>{modeLabel}</dd>
              </div>
            </dl>

            {presets.length > 0 ? (
              <div className="presets review-presets">
                <p className="hint">Saved demos</p>
                <div className="status-row">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="preset"
                      onClick={() => onPlan(null, { ...preset, mode: "qloo" })}
                      disabled={pending}
                    >
                      {preset.label}
                      {preset.ready ? " · instant" : ""}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="interview-nav">
        {step > 0 ? (
          <button type="button" className="nav-back" onClick={() => goTo(step - 1)}>
            Back
          </button>
        ) : (
          <span />
        )}

        {step < STEPS.length - 1 ? (
          <div className="nav-forward">
            {step === 2 ? (
              <button type="button" className="text-button skip" onClick={() => goTo(step + 1)}>
                Skip
              </button>
            ) : null}
            <button
              type="button"
              className="nav-next"
              onClick={() => {
                if (step === 0 && !canContinueFavorites) return;
                goTo(step + 1);
              }}
              disabled={step === 0 && !canContinueFavorites}
            >
              Continue
            </button>
          </div>
        ) : (
          <button type="submit" className={pending ? "cta pending" : "cta"} disabled={pending || cleanFavorites.length < 3}>
            {pending ? "Building the plan" : "Build the plan"}
          </button>
        )}
      </div>

      {step === STEPS.length - 1 ? (
        <p className="hint wait-note">The first live plan can take a minute. A saved preset returns immediately.</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      {health && health.ok === false ? (
        <p className="hint">The host may still be waking. Refresh in a minute.</p>
      ) : null}
    </form>
  );
}
