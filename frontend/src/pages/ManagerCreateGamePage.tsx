import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "../components/icons";
import {
  MUSIC_SOURCE_TABS,
  MusicSourceSwitch,
  type MusicSource,
} from "../components/MusicSourceSwitch";
import type { SetlistPanelState } from "../components/SetlistPanel";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../context/useToast";
import { usePrewarmBackend, useSlowPending } from "../hooks/useBackendWarmup";
import {
  ApiError,
  createGame,
  getCachedGenres,
  listGenres,
  loadSongPool,
  type CreateGameBody,
} from "../lib/api";
import { trackGameCreated, trackSetlistGameCreated } from "../lib/funnel";
import { setManagerToken } from "../lib/managerToken";
import { prefetchQuietly, whenIdle } from "../lib/preloadError";
import { countSongsInMix, describeMix, type MixTone } from "../lib/songPool";
import type { Genre, SongPoolCell } from "../lib/types";
import { AgreeNote } from "../components/LegalLinks";
import { Logo } from "../components/Logo";
import styles from "./ManagerCreateGamePage.module.css";

// "My own list" is its own chunk, so the page's first load does not grow: the
// page fetches it while idle (below), and React.lazy uses the same import.
const loadSetlistPanel = () => import("../components/SetlistPanel");
const SetlistPanel = lazy(() => loadSetlistPanel().then((m) => ({ default: m.SetlistPanel })));

const PASTE_LINE = "Paste your songs to start.";

// The bottom bar of My own list before a check: the song-line counter comes
// in My own list's chunk (lib/setlistText), and until it is there the panel
// is not either, so nothing is pasted yet and PASTE_LINE is right.
const PasteStatus = lazy(() =>
  import("../lib/setlistText").then(({ countSongLines }) => ({
    default: ({ text }: { text: string }) =>
      countSongLines(text) > 0 ? "Check your list to see the songs" : PASTE_LINE,
  })),
);

const EMPTY_LIST: SetlistPanelState = { text: "", check: null, checking: false };

// Which ends of Quick start's row have more mixes past the edge.
const NO_MORE = { start: false, end: false };

// The open tab's panel; each tab's id is `${PANEL_ID}-${tab}` (MusicSourceSwitch).
const PANEL_ID = "music-source-panel";

function tabIndex(id: MusicSource): number {
  return MUSIC_SOURCE_TABS.findIndex((t) => t.id === id);
}

// Decades are stored as their start year (the 80s = 1980); the picker floors a
// song's release_year to its decade and matches by membership (migration 032).
// Split into two fixed rows so the chips never wrap to a lonely orphan: the
// 20th-century decades on top, 2000s-onward below, under an "Any year" row
// that stands for no decade picked (the default). On desktop the rows collapse
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
// genre (optionally scoped to `decades`). Song counts verified against prod
// (2026-07-16): Everything 1185, Israeli Mix 497, International 606, Hot Now 291,
// Movie Night 137, 80s & 90s 313 — all ample for a game (~20-30 rounds).
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
  {
    label: "International",
    genreSlugs: ["rock", "pop", "hip-hop", "electronic", "soundtracks"],
    decades: [],
  },
  {
    label: "Hot Now",
    genreSlugs: [
      "mizrahit",
      "israeli-pop",
      "pop",
      "hip-hop",
      "israeli-rap-hip-hop",
      "israeli-rock-pop",
    ],
    decades: [2010, 2020],
  },
  { label: "Movie Night", genreSlugs: ["soundtracks", "israeli-soundtracks"], decades: [] },
  { label: "80s & 90s", genreSlugs: [], decades: [1980, 1990], allGenres: true },
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
  const { search } = useLocation();
  // `?test=1` marks this game as a test run (a check on the live site), so it
  // never counts as a real game. Harnesses are caught by their user agent.
  const testRun = new URLSearchParams(search).get("test") === "1";
  // The address decides the tab (one route, /manager/create/:source?, so the
  // page stays mounted and keeps every tab's state): no source is Genres,
  // "list" is My own list, and any other address goes to /manager/create.
  const { source } = useParams();
  const tab = MUSIC_SOURCE_TABS.find(
    (t) => t.to === (source === undefined ? "/manager/create" : `/manager/create/${source}`),
  );

  // Arriving from Home, the genres are usually cached already: draw them on
  // the first frame rather than behind a frame of placeholder tiles.
  const [genres, setGenres] = useState<Genre[]>(() => getCachedGenres() ?? []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedDecades, setSelectedDecades] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [genresLoading, setGenresLoading] = useState(() => genres.length === 0);
  // The catalog grouped by decade and genre set (migration 052), for the live
  // "N songs in this mix" line. null while loading or if it could not load:
  // then the page shows no count and blocks nothing, as before the count.
  const [songPool, setSongPool] = useState<SongPoolCell[] | null>(null);
  // My own list: the pasted text and its check, kept while another tab is open.
  const [setlist, setSetlist] = useState<SetlistPanelState>(EMPTY_LIST);
  // The tab on screen, and the side the last change came from: none for the
  // page's first content (it does not animate in), "back" when the new tab is
  // left of the old one. Updated during render, so the new content's first
  // frame already carries it.
  const [shown, setShown] = useState<{ id: MusicSource; dir?: "fwd" | "back" }>({
    id: tab?.id ?? "genres",
  });
  if (tab && tab.id !== shown.id) {
    setShown({ id: tab.id, dir: tabIndex(tab.id) < tabIndex(shown.id) ? "back" : "fwd" });
  }

  // On a phone Quick start's row is wider than the screen: each side that
  // hides more mixes gets a fade and an arrow (host-music-choices section 7).
  // Read on scroll and on a resize, and stored only when a side changes.
  const presetRow = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(NO_MORE);
  const syncMore = useCallback(() => {
    const row = presetRow.current;
    if (!row) return;
    const start = row.scrollLeft > 4;
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 4;
    setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
  }, []);
  // The first read is in the commit, before the first paint, so the arrows
  // appear at once rather than fading in when the page opens.
  const watchPresetRow = useCallback(
    (row: HTMLDivElement | null) => {
      presetRow.current = row;
      if (!row) return;
      syncMore();
      const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncMore);
      // The chips too: a web font arriving widens them, not the row.
      for (const el of [row, ...row.children]) resized?.observe(el);
      return () => {
        resized?.disconnect();
        presetRow.current = null;
        setMore(NO_MORE);
      };
    },
    [syncMore],
  );
  // A pressed arrow hides once the row reaches its end: the focus goes to the
  // other arrow, so a keyboard host keeps it, and the page does not scroll.
  // Before paint, while the hidden arrow still has the focus.
  const prevArrow = useRef<HTMLButtonElement | null>(null);
  const nextArrow = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (focused === null) return;
    if (focused === prevArrow.current && !more.start && more.end) {
      nextArrow.current?.focus({ preventScroll: true });
    } else if (focused === nextArrow.current && !more.end && more.start) {
      prevArrow.current?.focus({ preventScroll: true });
    }
  }, [more]);

  // Wake the Render backend so the create-game POST is warm. HomePage already
  // pre-warms on landing; this covers a direct deep-link to /manager/create.
  usePrewarmBackend();
  // Swap the button label from "Creating game…" to "Loading songs…" once the
  // create has stayed pending past ~2.5s (a cold start or a slow round-trip),
  // and after ~30s add a calm reassurance line below the form. The copy never
  // mentions the server/infrastructure — the host only cares about the game.
  const slowPending = useSlowPending(busy);
  const stillLoading = useSlowPending(busy, 30000);

  // Prefetch the console chunk while the host picks genres, so the jump to
  // /manager/game/:code after a successful create is instant (React.lazy in
  // App.tsx requests the same chunk — Vite dedupes it), and the route
  // transition never has to wait on a cold import. Same pattern as
  // JoinTeamPage's TeamGameplayPage prefetch.
  // My own list's code is fetched the same way once the page is idle, so its
  // tab opens with no wait; a failed fetch must not reload the page.
  useEffect(() => {
    void import("./ManagerConsolePage");
    return whenIdle(() => void prefetchQuietly(loadSetlistPanel));
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    void loadSongPool().then((cells) => {
      if (!cancelled) setSongPool(cells);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // No decade picked means any year, so "Any year" is on by default and comes
  // back on when the last decade is turned off.
  const anyYear = selectedDecades.size === 0;
  // null = nothing to say yet (no genre picked, or the counts are not loaded).
  const songCount =
    songPool && selected.size > 0 ? countSongsInMix(songPool, selected, selectedDecades) : null;
  const mix = songCount === null ? null : describeMix(songCount);
  // An empty mix would create a game whose first Start fails (issue #375).
  const mixEmpty = songCount === 0;
  const onList = shown.id === "list";
  // A list game needs a check of exactly this text (an edit clears it) with
  // songs to play, and no check running.
  const canCreate =
    !busy &&
    (onList
      ? !setlist.checking && (setlist.check?.pool_size ?? 0) > 0
      : selected.size > 0 && !mixEmpty);

  // The bottom bar says what to do next on the open tab, then what the game
  // holds; the same tones on both tabs.
  let status: ReactNode = mix?.text;
  let tone: MixTone | undefined = mix?.tone;
  if (onList) {
    const listMix = setlist.check ? describeMix(setlist.check.pool_size, "game") : null;
    tone = setlist.checking ? undefined : listMix?.tone;
    status = setlist.checking ? (
      "Checking your list…"
    ) : listMix ? (
      listMix.text
    ) : (
      <Suspense fallback={PASTE_LINE}>
        <PasteStatus text={setlist.text} />
      </Suspense>
    );
  } else if (selected.size === 0) {
    status = "Pick at least one genre to start.";
  }

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

  // An arrow moves the row by 70% of its width: smooth through the row's
  // scroll-behavior in the CSS, so the reduced-motion rule makes it instant.
  function slideMixes(side: -1 | 1) {
    const row = presetRow.current;
    row?.scrollBy({ left: side * row.clientWidth * 0.7 });
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
    if (!canCreate) return;
    const listCheck = setlist.check;
    // A list game sends the text exactly as pasted.
    const body: CreateGameBody = onList
      ? { setlist: { text: setlist.text } }
      : { selected_genres: Array.from(selected), selected_decades: Array.from(selectedDecades) };
    setBusy(true);
    try {
      const game = await createGame(body, { testRun });
      setManagerToken(game.game_code, game.manager_token);
      if (onList) {
        // The create answer's counts, or the check's if it has none.
        const counts = game.setlist ?? listCheck;
        if (counts) {
          trackSetlistGameCreated(counts.list_songs, counts.list_songs + counts.same_artist_songs);
        }
      } else {
        trackGameCreated(selected.size, selectedDecades.size);
      }
      toast(`Game ${game.game_code} created`, { variant: "success" });
      // Fetch the console's code first: the router would hold this page while
      // it downloads, and `finally` below would re-enable the button meanwhile,
      // inviting a second create. A failed import is recovered by
      // lib/preloadError when the route imports it for real.
      await import("./ManagerConsolePage").catch(() => undefined);
      navigate(`/manager/game/${game.game_code}`);
    } catch (err) {
      // A refusal of the list itself (setlist_empty when the catalog changed
      // since the check, ...) makes the check wrong: Create turns off and the
      // same text can be checked again. Any other failure keeps the check.
      if (err instanceof ApiError && err.code.startsWith("setlist_")) {
        setSetlist((s) => ({ ...s, check: null }));
      }
      toast(err instanceof Error ? err.message : "Failed to create game", { variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!tab) return <Navigate to={`/manager/create${search}`} replace />;

  const rowOverflows = more.start || more.end;
  const genresContent = (
    <>
      {!genresLoading && genres.length > 0 && (
        <div className={styles.presets}>
          <div className={styles.presetsHead}>
            <span className={styles.presetsLabel}>Quick start</span>
            <span className={styles.presetsCount} data-testid="quick-start-count">
              {PRESETS.length} mixes
            </span>
          </div>
          {/* data-start / data-end only while the row overflows: the fades
              and the arrows exist only then, so none shows on a desktop.
              The arrows sit around the row in the DOM as on screen, so the
              tab order runs Previous, the mixes, More. */}
          <div
            className={styles.presetsWrap}
            {...(rowOverflows && {
              "data-start": String(more.start),
              "data-end": String(more.end),
            })}
          >
            {rowOverflows && (
              <button
                ref={prevArrow}
                type="button"
                className={`${styles.presetNav} ${styles.presetPrev}`}
                data-testid="quick-start-prev"
                aria-label="Previous mixes"
                onClick={() => slideMixes(-1)}
              >
                <span>
                  <ArrowLeftIcon />
                </span>
              </button>
            )}
            <div ref={watchPresetRow} className={styles.presetRow} onScroll={syncMore}>
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
            {rowOverflows && (
              <button
                ref={nextArrow}
                type="button"
                className={`${styles.presetNav} ${styles.presetNext}`}
                data-testid="quick-start-next"
                aria-label="More mixes"
                onClick={() => slideMixes(1)}
              >
                <span>
                  <ArrowRightIcon />
                </span>
              </button>
            )}
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
                  <span className={styles.genreCheck} aria-hidden="true">
                    <CheckIcon />
                  </span>
                  {g.name}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Release decade</span>
        <div className={styles.decades}>
          <div className={styles.decadeRow}>
            {/* Checked exactly when no decade is picked; ticking it clears
                  the decades, and ticking it again leaves it on. */}
            <label
              className={`${styles.decade} ${styles.decadeAny} ${anyYear ? styles.decadeSelected : ""}`}
            >
              <input
                type="checkbox"
                checked={anyYear}
                onChange={() => setSelectedDecades(new Set())}
              />
              Any year
            </label>
          </div>
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
    </>
  );

  return (
    <main className={styles.shell}>
      <header>
        <div className={styles.brand}>
          <Logo size="small" />
        </div>
        <h1>Host a game</h1>
        <p className={`muted ${styles.lead}`}>Choose how to pick the songs</p>
        <MusicSourceSwitch tabs={MUSIC_SOURCE_TABS} active={shown.id} panelId={PANEL_ID} />
      </header>

      <form className="stack" onSubmit={handleSubmit}>
        {/* Keyed by the tab: a new tab's content is a new element, so it
            enters with @starting-style, and the old one leaves at once. */}
        <div
          key={shown.id}
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={`${PANEL_ID}-${shown.id}`}
          className={`stack ${styles.panel}`}
          data-testid="music-source-panel"
          data-first={shown.dir ? undefined : ""}
          data-dir={shown.dir}
        >
          {onList ? (
            <Suspense fallback={<Skeleton height={320} />}>
              <SetlistPanel value={setlist} onChange={setSetlist} />
            </Suspense>
          ) : (
            genresContent
          )}
        </div>

        <div className={styles.actions}>
          <Link to="/" className="btn btn-ghost">
            Cancel
          </Link>
          {/* What to do next, then the game's song count, in the bar that
              stays on screen while the host taps, so an empty mix is flagged
              the moment it is picked. Always mounted (empty while the counts
              load) so screen readers announce each change. */}
          <p
            className={`${styles.mixCount} ${
              tone === "empty" ? styles.mixEmpty : tone === "small" ? styles.mixSmall : ""
            }`}
            role="status"
            data-testid="mix-count"
          >
            {status}
          </p>
          <button type="submit" className="btn btn-primary" disabled={!canCreate}>
            {busy ? (
              <>
                <span className={styles.spinner} data-testid="submit-spinner" aria-hidden="true" />
                {slowPending ? "Loading songs…" : "Creating game…"}
              </>
            ) : (
              "Create game"
            )}
          </button>
          <AgreeNote action="creating a game" className={styles.agree} />
        </div>

        {stillLoading && (
          <p className={styles.helper} role="status">
            Still loading — hang tight, almost ready.
          </p>
        )}
      </form>
    </main>
  );
}
