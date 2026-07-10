import { useMemo, useState, type FormEvent } from "react";
import type { Genre, Song, SongWritePayload } from "../lib/types";
import styles from "../pages/AdminSongsPage.module.css";

// Extracted from AdminSongsPage (T7.2, was the inline `SongForm`). The
// create/edit song form: local field state, client-side validation, and the
// genre multi-select. Pure move — the FormState shape, the validation rules,
// and the payload mapping are unchanged.

const YT_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

interface FormState {
  title: string;
  artist: string;
  youtube_id: string;
  start_time: string;
  release_year: string;
  genre_ids: Set<string>;
}

const EMPTY_FORM: FormState = {
  title: "",
  artist: "",
  youtube_id: "",
  start_time: "0",
  release_year: "",
  genre_ids: new Set(),
};

// Build the initial field state for the edit target, or the empty form when
// creating. Kept internal so the page passes the raw `song` and this component
// owns the Song → form-fields mapping (the page never touches FormState).
function initialForm(song: Song | undefined): FormState {
  if (!song) return EMPTY_FORM;
  return {
    title: song.title,
    artist: song.artist,
    youtube_id: song.youtube_id,
    start_time: String(song.start_time),
    release_year: song.release_year != null ? String(song.release_year) : "",
    genre_ids: new Set((song.genres ?? []).map((g) => g.id)),
  };
}

function formToPayload(form: FormState): SongWritePayload {
  return {
    title: form.title.trim(),
    artist: form.artist.trim(),
    youtube_id: form.youtube_id.trim(),
    start_time: Number(form.start_time),
    release_year: form.release_year.trim() === "" ? null : Number(form.release_year),
    genre_ids: Array.from(form.genre_ids),
  };
}

function formIsValid(form: FormState): boolean {
  if (form.title.trim().length === 0 || form.title.trim().length > 200) return false;
  if (form.artist.trim().length === 0 || form.artist.trim().length > 200) return false;
  if (!YT_ID_PATTERN.test(form.youtube_id.trim())) return false;
  const start = Number(form.start_time);
  if (!Number.isInteger(start) || start < 0) return false;
  const year = form.release_year.trim();
  if (year !== "") {
    const y = Number(year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) return false;
  }
  if (form.genre_ids.size === 0) return false;
  return true;
}

interface SongEditFormProps {
  genres: Genre[];
  // The song being edited, or undefined when creating a new one. The form seeds
  // its fields from this once on mount; the parent remounts it (via a keyed
  // element) when the target changes, so it isn't re-read after mount.
  song: Song | undefined;
  submitLabel: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: SongWritePayload) => void;
}

export function SongEditForm({
  genres,
  song,
  submitLabel,
  busy,
  onCancel,
  onSubmit,
}: SongEditFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(song));

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
      <p className="muted">
        Tagging a song with the Soundtracks or Israeli Soundtracks genre makes it a +15 “name the
        film/show” round. For those, put the film/show name in <strong>Artist</strong> (that’s the
        answer revealed on screen); <strong>Title</strong> is the song/clip name, shown only as a
        hint. Set Title equal to the film name when there’s no distinct song.
      </p>
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
        <label className={styles.field}>
          <span>Release year (optional)</span>
          <input
            type="number"
            min={1900}
            max={2100}
            placeholder="e.g. 1985"
            value={form.release_year}
            onChange={(e) => setForm({ ...form, release_year: e.target.value })}
            aria-label="Release year"
          />
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
