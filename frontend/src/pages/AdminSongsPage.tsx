import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../context/useToast";
import {
  ApiError,
  bulkImportSongs,
  createSong,
  deleteSong,
  listGenres,
  listSongs,
  updateSong,
} from "../lib/api";
import { clearAdminPassword, getAdminPassword, setAdminPassword } from "../lib/adminPassword";
import type { Genre, Song, SongWritePayload } from "../lib/types";
import styles from "./AdminSongsPage.module.css";

const PER_PAGE = 50;
const YT_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const SEARCH_DEBOUNCE_MS = 250;

type Mode = { kind: "list" } | { kind: "create" } | { kind: "edit"; song: Song };

interface FormState {
  title: string;
  artist: string;
  youtube_id: string;
  start_time: string;
  is_soundtrack: boolean;
  source: string;
  genre_ids: Set<string>;
}

const EMPTY_FORM: FormState = {
  title: "",
  artist: "",
  youtube_id: "",
  start_time: "0",
  is_soundtrack: false,
  source: "",
  genre_ids: new Set(),
};

function songToForm(song: Song, genreIds: string[]): FormState {
  return {
    title: song.title,
    artist: song.artist,
    youtube_id: song.youtube_id,
    start_time: String(song.start_time),
    is_soundtrack: song.is_soundtrack,
    source: song.source ?? "",
    genre_ids: new Set(genreIds),
  };
}

function formToPayload(form: FormState): SongWritePayload {
  return {
    title: form.title.trim(),
    artist: form.artist.trim(),
    youtube_id: form.youtube_id.trim(),
    start_time: Number(form.start_time),
    is_soundtrack: form.is_soundtrack,
    source: form.source.trim() === "" ? null : form.source.trim(),
    genre_ids: Array.from(form.genre_ids),
  };
}

function formIsValid(form: FormState): boolean {
  if (form.title.trim().length === 0 || form.title.trim().length > 200) return false;
  if (form.artist.trim().length === 0 || form.artist.trim().length > 200) return false;
  if (!YT_ID_PATTERN.test(form.youtube_id.trim())) return false;
  const start = Number(form.start_time);
  if (!Number.isInteger(start) || start < 0) return false;
  if (form.source.trim().length > 200) return false;
  if (form.genre_ids.size === 0) return false;
  return true;
}

export function AdminSongsPage() {
  const { toast } = useToast();
  const [pw, setPw] = useState<string | null>(getAdminPassword());

  if (pw === null) {
    return (
      <PasswordGate
        onSubmit={(value) => {
          setAdminPassword(value);
          setPw(value);
        }}
      />
    );
  }

  return (
    <SongsConsole
      pw={pw}
      onAuthFail={() => {
        clearAdminPassword();
        setPw(null);
        toast("Admin password rejected", { variant: "error" });
      }}
      onSignOut={() => {
        clearAdminPassword();
        setPw(null);
      }}
    />
  );
}

interface PasswordGateProps {
  onSubmit: (value: string) => void;
}

function PasswordGate({ onSubmit }: PasswordGateProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (value.length === 0) return;
    onSubmit(value);
  }

  return (
    <main className={styles.shell}>
      <form className={styles.gate} onSubmit={handleSubmit}>
        <h1>Song catalog</h1>
        <p>Enter the admin password to manage songs.</p>
        <label className={styles.field}>
          <span>Admin password</span>
          <input
            type="password"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label="Admin password"
          />
        </label>
        <div className={styles.formActions}>
          <button type="submit" className="btn btn-primary" disabled={value.length === 0}>
            Sign in
          </button>
        </div>
      </form>
    </main>
  );
}

interface SongsConsoleProps {
  pw: string;
  onAuthFail: () => void;
  onSignOut: () => void;
}

function SongsConsole({ pw, onAuthFail, onSignOut }: SongsConsoleProps) {
  const { toast } = useToast();
  const [songs, setSongs] = useState<Song[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [genreFilter, setGenreFilter] = useState("");
  const [genres, setGenres] = useState<Genre[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reportError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) {
        onAuthFail();
        return;
      }
      toast(err instanceof Error ? err.message : fallback, { variant: "error" });
    },
    [onAuthFail, toast],
  );

  // Load genres once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listGenres();
        if (!cancelled) setGenres(list);
      } catch (err) {
        if (!cancelled) reportError(err, "Failed to load genres");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  // Debounce search input → search.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  // Refetch when filter inputs change.
  const fetchSongs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listSongs(
        {
          page,
          per_page: PER_PAGE,
          search: search || undefined,
          genre: genreFilter || undefined,
        },
        pw,
      );
      setSongs(res.items);
      setTotal(res.total);
    } catch (err) {
      reportError(err, "Failed to load songs");
    } finally {
      setLoading(false);
    }
  }, [genreFilter, page, pw, reportError, search]);

  useEffect(() => {
    void fetchSongs();
  }, [fetchSongs]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const songToFilterEdit = useCallback((song: Song) => {
    // Backend doesn't return genre links on the song row; preselect nothing.
    // Operator can re-pick. (A future enhancement could add ?include=genres.)
    setMode({ kind: "edit", song });
  }, []);

  async function handleSubmitForm(payload: SongWritePayload) {
    setBusy(true);
    try {
      if (mode.kind === "create") {
        await createSong(payload, pw);
        toast("Song created", { variant: "success" });
      } else if (mode.kind === "edit") {
        await updateSong(mode.song.id, payload, pw);
        toast("Song updated", { variant: "success" });
      }
      setMode({ kind: "list" });
      await fetchSongs();
    } catch (err) {
      reportError(err, "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    if (deleteId === null) return;
    setBusy(true);
    try {
      await deleteSong(deleteId, pw);
      toast("Song deleted", { variant: "success" });
      setDeleteId(null);
      await fetchSongs();
    } catch (err) {
      reportError(err, "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const summary = await bulkImportSongs(file, pw);
      toast(
        `Imported ${summary.inserted} new + ${summary.updated} updated (${summary.total} total)`,
        { variant: "success" },
      );
      await fetchSongs();
    } catch (err) {
      reportError(err, "Import failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <h1>Song catalog</h1>
        <button type="button" className="btn btn-ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Search by title…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search songs"
        />
        <select
          value={genreFilter}
          onChange={(e) => {
            setGenreFilter(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by genre"
        >
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g.id} value={g.slug}>
              {g.name}
            </option>
          ))}
        </select>
        <div className={styles.right}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMode({ kind: "create" })}
            disabled={busy || mode.kind !== "list"}
          >
            + New song
          </button>
          <label className={`btn ${styles.fileLabel}`}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              disabled={busy}
              aria-label="Bulk import CSV"
            />
            Bulk import CSV
          </label>
        </div>
      </div>

      {mode.kind !== "list" ? (
        <SongForm
          key={mode.kind === "edit" ? mode.song.id : "create"}
          genres={genres}
          initial={mode.kind === "edit" ? songToForm(mode.song, []) : EMPTY_FORM}
          submitLabel={mode.kind === "edit" ? "Save changes" : "Create song"}
          busy={busy}
          onCancel={() => setMode({ kind: "list" })}
          onSubmit={handleSubmitForm}
        />
      ) : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Artist</th>
              <th>YouTube ID</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`s-${i}`}>
                  <td>
                    <Skeleton width="80%" height={16} />
                  </td>
                  <td>
                    <Skeleton width="60%" height={16} />
                  </td>
                  <td>
                    <Skeleton width="100px" height={16} />
                  </td>
                  <td />
                </tr>
              ))
            ) : songs.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles.empty}>
                  No songs found.
                </td>
              </tr>
            ) : (
              songs.map((s) => (
                <tr key={s.id}>
                  <td>{s.title}</td>
                  <td>{s.artist}</td>
                  <td className={styles.ytId}>{s.youtube_id}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => songToFilterEdit(s)}
                        disabled={busy}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setDeleteId(s.id)}
                        disabled={busy}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && total > 0 ? (
        <div className={styles.pagination}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || busy}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages} ({total} songs)
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || busy}
          >
            Next
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteId !== null}
        title="Delete this song?"
        message="This permanently removes the song from the catalog."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={() => setDeleteId(null)}
      />
    </main>
  );
}

interface SongFormProps {
  genres: Genre[];
  initial: FormState;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: SongWritePayload) => void;
}

function SongForm({ genres, initial, submitLabel, busy, onCancel, onSubmit }: SongFormProps) {
  const [form, setForm] = useState<FormState>(initial);

  const valid = useMemo(() => formIsValid(form), [form]);

  function toggleGenre(id: string) {
    setForm((prev) => {
      const next = new Set(prev.genre_ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, genre_ids: next };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    onSubmit(formToPayload(form));
  }

  return (
    <form className={styles.formPanel} onSubmit={handleSubmit}>
      <h2>{submitLabel}</h2>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Title</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={200}
            aria-label="Title"
          />
        </label>
        <label className={styles.field}>
          <span>Artist</span>
          <input
            type="text"
            value={form.artist}
            onChange={(e) => setForm({ ...form, artist: e.target.value })}
            maxLength={200}
            aria-label="Artist"
          />
        </label>
        <label className={styles.field}>
          <span>YouTube ID (11 chars)</span>
          <input
            type="text"
            value={form.youtube_id}
            onChange={(e) => setForm({ ...form, youtube_id: e.target.value })}
            maxLength={11}
            spellCheck={false}
            aria-label="YouTube ID"
          />
        </label>
        <label className={styles.field}>
          <span>Start time (seconds)</span>
          <input
            type="number"
            min={0}
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            aria-label="Start time"
          />
        </label>
        <label className={`${styles.field} ${styles.fieldFull}`}>
          <span>Source (optional: film, game, album)</span>
          <input
            type="text"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            maxLength={200}
            aria-label="Source"
          />
        </label>
        <label className={`${styles.field} ${styles.checkboxField}`}>
          <input
            type="checkbox"
            checked={form.is_soundtrack}
            onChange={(e) => setForm({ ...form, is_soundtrack: e.target.checked })}
            aria-label="Is soundtrack"
          />
          <span>Mark as soundtrack</span>
        </label>
        <div className={`${styles.field} ${styles.fieldFull}`}>
          <span>Genres ({form.genre_ids.size} selected)</span>
          <div className={styles.genres}>
            {genres.map((g) => {
              const sel = form.genre_ids.has(g.id);
              return (
                <label
                  key={g.id}
                  className={`${styles.genreChip} ${sel ? styles.genreSelected : ""}`}
                >
                  <input type="checkbox" checked={sel} onChange={() => toggleGenre(g.id)} />
                  {g.name}
                </label>
              );
            })}
          </div>
        </div>
      </div>
      <div className={styles.formActions}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
