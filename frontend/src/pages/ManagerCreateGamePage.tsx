import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../context/useToast";
import { usePrewarmBackend, useSlowPending } from "../hooks/useBackendWarmup";
import { createGame, listGenres } from "../lib/api";
import { setManagerToken } from "../lib/managerToken";
import type { Genre } from "../lib/types";
import styles from "./ManagerCreateGamePage.module.css";

// Decades are stored as their start year (the 80s = 1980); the picker floors a
// song's release_year to its decade and matches by membership (migration 032).
// Split into two fixed rows so the chips never wrap to a lonely orphan: the
// 20th-century decades on top, 2000s-onward below. On desktop the rows collapse
// back into a single line (see .decadeRow display:contents in the CSS).
const DECADE_ROWS = [
  [1960, 1970, 1980, 1990],
  [2000, 2010, 2020],
] as const;

function decadeLabel(decade: number): string {
  // 1960–1990 use the familiar two-digit shorthand ("80s"); 2000 onward spell
  // the full year ("2000s") because "00s"/"10s" read as ambiguous. Matches how
  // Spotify / Apple Music label their decade playlists.
  return decade < 2000 ? `${String(decade).slice(2)}s` : `${decade}s`;
}

// One-tap curated presets (X-Presets). Frontend-only: each preset is resolved
// against the genres already loaded from the catalog, so it only pre-fills the
// existing selection — no new payload field. `genreSlugs` are matched to genre
// ids; slugs absent from the catalog are silently skipped, so a preset degrades
// gracefully if the genre set ever changes. `allGenres` selects every loaded
// genre. Song counts verified against prod (2026-07-11): Everything ~800,
// Israeli ~497, Movie Night ~113, 80s–90s rock+pop ~83 — all ample for a game.
type Preset = {
  label: string;
  genreSlugs: readonly string[];
  decades: readonly number[];
  allGenres?: boolean;
};

const PRESETS: readonly Preset[] = [
  { label: "Everything", genreSlugs: [], decades: [], allGenres: true },
  {
    label: "Israeli Mix",
    genreSlugs: [
      "israeli-pop",
      "israeli-rock-pop",
      "israeli-rap-hip-hop",
      "israeli-cover",
      "mizrahit",
      "israeli-soundtracks",
    ],
    decades: [],
  },
  { label: "80s & 90s Party", genreSlugs: ["rock", "pop"], decades: [1980, 1990] },
  { label: "Movie Night", genreSlugs: ["soundtracks", "israeli-soundtracks"], decades: [] },
];

// Resolve a preset's genre slugs to the ids of the currently-loaded genres.
function resolvePresetGenreIds(preset: Preset, genres: Genre[]): string[] {
  if (preset.allGenres) return genres.map((g) => g.id);
  const idBySlug = new Map(genres.map((g) => [g.slug, g.id]));
  return preset.genreSlugs
    .map((slug) => idBySlug.get(slug))
    .filter((id): id is string => id !== undefined);
}

function sameMembers<T>(a: Set<T>, b: Iterable<T>): boolean {
  const other = b instanceof Set ? b : new Set(b);
  if (a.size !== other.size) return false;
  for (const v of a) if (!other.has(v)) return false;
  return true;
}

export function ManagerCreateGamePage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [genres, setGenres] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDecades, setSelectedDecades] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [genresLoading, setGenresLoading] = useState(true);

  // Wake the Render backend so the create-game POST is warm. HomePage already
  // pre-warms on landing; this covers a direct deep-link to /manager/create.
  usePrewarmBackend();
  // Surface a "waking the server…" hint if create stays pending past ~2.5s.
  const wakingServer = useSlowPending(busy);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listGenres();
        if (!cancelled) setGenres(list);
      } catch (err) {
        if (cancelled) return;
        toast(err instanceof Error ? err.message : "Failed to load genres", { variant: "error" });
      } finally {
        if (!cancelled) setGenresLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  function toggleGenre(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDecade(decade: number) {
    setSelectedDecades((prev) => {
      const next = new Set(prev);
      if (next.has(decade)) next.delete(decade);
      else next.add(decade);
      return next;
    });
  }

  // A preset replaces the current genre + decade selection with its curated set
  // (the host can still fine-tune the chips afterwards). Pre-fill only — it does
  // not auto-create the game, so the host always reviews before submitting.
  function applyPreset(preset: Preset) {
    setSelected(new Set(resolvePresetGenreIds(preset, genres)));
    setSelectedDecades(new Set(preset.decades));
  }

  // Highlight the preset (if any) whose resolved genres + decades exactly match
  // the live selection, so the chips and the active preset stay in sync as the
  // host edits. An empty selection matches nothing (no preset is "all off").
  function isPresetActive(preset: Preset): boolean {
    const ids = resolvePresetGenreIds(preset, genres);
    if (ids.length === 0) return false;
    return sameMembers(selected, ids) && sameMembers(selectedDecades, preset.decades);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const game = await createGame({
        selected_genres: Array.from(selected),
        selected_decades: Array.from(selectedDecades),
      });
      setManagerToken(game.game_code, game.manager_token);
      toast(`Game ${game.game_code} created`, { variant: "success" });
      navigate(`/manager/game/${game.game_code}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create game", { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header>
        <h1>Host a game</h1>
        <p className="muted">Pick at least one genre to start.</p>
      </header>

      <form className="stack" onSubmit={handleSubmit}>
        {!genresLoading && genres.length > 0 && (
          <div className={styles.presets}>
            <span className={styles.presetsLabel}>Quick start</span>
            <div className={styles.presetRow}>
              {PRESETS.map((preset) => {
                const active = isPresetActive(preset);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={`${styles.preset} ${active ? styles.presetActive : ""}`}
                    aria-pressed={active}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.label}>
            Genres <span className="muted">({selected.size} selected)</span>
          </span>
          {genresLoading ? (
            <div className={styles.genres}>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={44} />
              ))}
            </div>
          ) : (
            <div className={styles.genres}>
              {genres.map((g) => {
                const isSel = selected.has(g.id);
                return (
                  <label
                    key={g.id}
                    className={`${styles.genre} ${isSel ? styles.genreSelected : ""}`}
                  >
                    <input type="checkbox" checked={isSel} onChange={() => toggleGenre(g.id)} />
                    {g.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.label}>
            Release decade <span className="muted">(optional — any year if none picked)</span>
          </span>
          <div className={styles.decades}>
            {DECADE_ROWS.map((row, i) => (
              <div key={i} className={styles.decadeRow}>
                {row.map((d) => {
                  const isSel = selectedDecades.has(d);
                  return (
                    <label
                      key={d}
                      className={`${styles.decade} ${isSel ? styles.decadeSelected : ""}`}
                    >
                      <input type="checkbox" checked={isSel} onChange={() => toggleDecade(d)} />
                      {decadeLabel(d)}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <Link to="/" className="btn btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={selected.size === 0 || busy}>
            {busy ? (wakingServer ? "Waking the server — up to 30s…" : "Creating…") : "Create game"}
          </button>
        </div>
      </form>
    </main>
  );
}
