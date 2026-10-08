import { useEffect, useState } from "react";

const SUGGESTIONS = ["Wong Kar-wai", "Aphex Twin", "Sourdough bakeries", "Criterion Collection"];
const HUBS = ["Lisbon", "Tokyo", "Berlin", "Mexico City", "Montreal"];

const LANES = [
  { id: "dining", label: "Dining & Bistros", target: "place" },
  { id: "listening", label: "Listening Bars & Live Music", target: "place" },
  { id: "cinema", label: "Indie Cinema & Theatres", target: "movie" },
  { id: "books", label: "Bookshops & Cafés", target: "place" },
  { id: "late", label: "Late Night & Hidden Spots", target: "place" },
  { id: "art", label: "Art & Design Spaces", target: "place" },
];

const PATHS = [
  {
    id: "johannesburg",
    title: "Johannesburg night out",
    copy: "A night built from Radiohead, Amélie, and ramen.",
    cityQuery: "Johannesburg",
  },
  {
    id: "lisbon",
    title: "Lisbon afternoon",
    copy: "The same favorites, walked through Lisbon.",
    scene: "Lisbon tiled street cafe",
  },
  {
    id: "movies",
    title: "Movie night",
    copy: "Radiohead, Amélie, and ramen, ranked as films.",
    scene: "movie theater seats",
  },
];

function chipKind(name) {
  const value = name.toLowerCase();
  if (/film|cinema|amélie|amelie|wong|criterion|ghibli/.test(value)) return "film";
  if (/radiohead|aphex|music|band/.test(value)) return "music";
  if (/ramen|sourdough|food|espresso|wine/.test(value)) return "food";
  return "mark";
}

function ChipIcon({ kind }) {
  if (kind === "film") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4" />
      </svg>
    );
  }
  if (kind === "music") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 18a3 3 0 1 1-2-2.83V6l10-2v10" />
        <circle cx="17" cy="16" r="2" />
      </svg>
    );
  }
  if (kind === "food") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 4v7a3 3 0 0 0 3 3v6M9 4v6M15 4c2 3 2 6 2 8a3 3 0 0 1-3 3v5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PathwayCard({ path, preset, pending, onOpen }) {
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const request = path.cityQuery
      ? `/api/mood?city=${encodeURIComponent(path.cityQuery)}`
      : `/api/mood?scene=${encodeURIComponent(path.scene)}`;
    fetch(request)
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) setPhoto(body.photo || null);
      })
      .catch(() => {
        if (!cancelled) setPhoto(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path.cityQuery, path.scene]);

  const count = preset?.favorites?.length || 3;
  return (
    <article className="path-card">
      <div className="path-photo">
        {photo ? <img src={photo.imageUrl} alt={photo.alt} /> : <span>{path.title.slice(0, 1)}</span>}
        <em>{preset?.city || (path.id === "movies" ? "Films" : path.title)}</em>
      </div>
      <div className="path-copy">
        <h3>{path.title}</h3>
        <p>{path.copy}</p>
        {photo ? (
          <p className="path-credit">
            Photograph by <a href={photo.photographerUrl} target="_blank" rel="noreferrer">{photo.photographer}</a> on <a href={photo.unsplashUrl} target="_blank" rel="noreferrer">Unsplash</a>
          </p>
        ) : null}
        <button type="button" onClick={() => onOpen(preset)} disabled={pending || !preset}>
          <span>{count} favorites mapped{preset?.ready ? " · instant" : ""}</span>
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </article>
  );
}

export function HomeDesk({
  favorites,
  setFavorites,
  target,
  city,
  setCity,
  presets,
  pending,
  error,
  onPlan,
}) {
  const [draft, setDraft] = useState("");
  const [lanes, setLanes] = useState(() => (target === "movie" ? ["cinema"] : ["dining", "listening"]));
  const clean = favorites.map((item) => item.trim()).filter(Boolean);

  function addFavorite(raw) {
    const value = String(raw || "").trim();
    if (!value || clean.length >= 5) return;
    if (clean.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    setFavorites([...clean, value].slice(0, 5));
    setDraft("");
  }

  function toggleLane(id) {
    setLanes((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  }

  function translate(event) {
    event.preventDefault();
    const chosen = LANES.filter((lane) => lanes.includes(lane.id));
    const nextTarget = chosen.some((lane) => lane.target === "place") || chosen.length === 0 ? "place" : "movie";
    onPlan(event, { target: nextTarget, mode: "qloo" });
  }

  return (
    <div className="home-desk">
      <p className="wake-note">Gentle note: The first load can take up to a minute to wake up taste models.</p>
      <h1>
        Your first week in a new city,<br />
        <em>matched to your taste.</em>
      </h1>
      <p className="lede home-lede">
        Taste Desk turns the things you love into real places to go — mapping your cinema, music, and food obsessions into neighborhood gems that actually share their DNA.
      </p>

      <form className="composer" onSubmit={translate}>
        <section>
          <div className="composer-head">
            <h2><span>1</span> What do you love?</h2>
            <p className="count-pill">{clean.length} of 5 added (minimum 3 required)</p>
          </div>
          <p className="composer-help">Type 3 to 5 favorites — bands, films, directors, books, dishes, or subcultures.</p>
          <div className="love-entry">
            {clean.map((item) => (
              <button key={item} type="button" className="love-chip" onClick={() => setFavorites(clean.filter((value) => value !== item))} aria-label={`Remove ${item}`}>
                <ChipIcon kind={chipKind(item)} />
                {item}
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <input
              aria-label="Add a favorite"
              value={draft}
              placeholder="e.g. Haruki Murakami, Natural Wine"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addFavorite(draft);
                }
              }}
              disabled={clean.length >= 5}
            />
            <button type="button" className="love-add" onClick={() => addFavorite(draft)} disabled={!draft.trim() || clean.length >= 5}>
              + Add
            </button>
          </div>
          <div className="suggest-line">
            <span>Suggestions:</span>
            {SUGGESTIONS.map((item) => {
              const taken = clean.some((favorite) => favorite.toLowerCase() === item.toLowerCase());
              return (
                <button key={item} type="button" onClick={() => addFavorite(item)} disabled={taken || clean.length >= 5}>
                  + {item}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2><span>2</span> What are you looking for?</h2>
          <div className="lane-grid" role="group" aria-label="What are you looking for?">
            {LANES.map((lane) => {
              const on = lanes.includes(lane.id);
              return (
                <button
                  key={lane.id}
                  type="button"
                  className={on ? "lane on" : "lane"}
                  aria-pressed={on}
                  onClick={() => toggleLane(lane.id)}
                >
                  <i aria-hidden="true">{on ? "✓" : ""}</i>
                  {lane.label}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2><span>3</span> Where are you landing?</h2>
          <label className="city-field">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.2" />
            </svg>
            <input aria-label="City" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Johannesburg, South Africa" />
          </label>
          <div className="hub-line">
            <span>Frequent hubs:</span>
            {HUBS.map((hub) => (
              <button key={hub} type="button" className={city.trim().toLowerCase() === hub.toLowerCase() ? "hub on" : "hub"} onClick={() => setCity(hub)}>
                {hub}
              </button>
            ))}
          </div>
        </section>

        <button type="submit" className="translate" disabled={pending || clean.length < 3}>
          {pending ? "Translating your taste" : "Translate my taste"}
          <span aria-hidden="true">→</span>
        </button>
        {error ? <p className="form-error">{error}</p> : null}
      </form>

      <section className="pathways" id="examples">
        <div className="pathways-head">
          <div>
            <p className="eyebrow">Curated pathways</p>
            <h2>Try an example, instant results</h2>
          </div>
          <p>Explore ready-to-run taste profiles compiled from the saved plans.</p>
        </div>
        <div className="path-grid">
          {PATHS.map((path) => (
            <PathwayCard
              key={path.id}
              path={path}
              preset={presets.find((item) => item.id === path.id)}
              pending={pending}
              onOpen={(preset) => onPlan(null, { ...preset, mode: "qloo" })}
            />
          ))}
        </div>
      </section>

      <aside className="graph-note">
        <div>
          <strong>Multi-dimensional Taste Graph</strong>
          <p>Connecting cultural affinities across cinema, literature, gastronomy, and design.</p>
        </div>
      </aside>
    </div>
  );
}
