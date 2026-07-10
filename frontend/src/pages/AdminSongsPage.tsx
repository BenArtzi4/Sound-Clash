import { useState, type FormEvent } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SongEditForm } from "../components/SongEditForm";
import { SongTable } from "../components/SongTable";
import { useToast } from "../context/useToast";
import { useAdminSongs } from "../hooks/useAdminSongs";
import { clearAdminPassword, getAdminPassword, setAdminPassword } from "../lib/adminPassword";
import styles from "./AdminSongsPage.module.css";

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
  const {
    songs,
    total,
    totalPages,
    page,
    setPage,
    searchInput,
    setSearchInput,
    genreFilter,
    setGenreFilter,
    genres,
    mode,
    setMode,
    deleteId,
    setDeleteId,
    loading,
    busy,
    fileInputRef,
    startEdit,
    handleSubmitForm,
    handleConfirmDelete,
    handleFile,
  } = useAdminSongs({ pw, onAuthFail });

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
          onChange={(e) => setGenreFilter(e.target.value)}
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
        <SongEditForm
          key={mode.kind === "edit" ? mode.song.id : "create"}
          genres={genres}
          song={mode.kind === "edit" ? mode.song : undefined}
          submitLabel={mode.kind === "edit" ? "Save changes" : "Create song"}
          busy={busy}
          onCancel={() => setMode({ kind: "list" })}
          onSubmit={handleSubmitForm}
        />
      ) : null}

      <SongTable
        songs={songs}
        loading={loading}
        busy={busy}
        onEdit={startEdit}
        onDelete={(id) => setDeleteId(id)}
      />

      {total > 0 ? (
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
