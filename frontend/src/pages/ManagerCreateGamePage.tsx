import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ApiError, createGame, listGenres } from "../lib/api";
import type { Genre } from "../lib/types";
import styles from "./ManagerCreateGamePage.module.css";

export function ManagerCreateGamePage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [genres, setGenres] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [totalRounds, setTotalRounds] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await listGenres();
        if (!cancelled) setGenres(list);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load genres");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleGenre(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const game = await createGame({
        total_rounds: totalRounds,
        selected_genres: Array.from(selected),
      });
      navigate(`/manager/game/${game.game_code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate("/manager/login", { replace: true });
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to create game");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <header>
        <h1>Create a game</h1>
        <p className="muted">Pick at least one genre and the round count.</p>
      </header>

      <form className="stack" onSubmit={handleSubmit}>
        <div className={styles.field}>
          <span className={styles.label}>Rounds</span>
          <div className={styles.rounds}>
            <input
              type="range"
              min={1}
              max={50}
              value={totalRounds}
              onChange={(e) => setTotalRounds(Number(e.target.value))}
            />
            <span className={styles.roundsValue}>{totalRounds}</span>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>
            Genres{" "}
            <span className="muted">
              ({selected.size} selected)
            </span>
          </span>
          <div className={styles.genres}>
            {genres.map((g) => {
              const isSel = selected.has(g.id);
              return (
                <label
                  key={g.id}
                  className={`${styles.genre} ${
                    isSel ? styles.genreSelected : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggleGenre(g.id)}
                  />
                  {g.name}
                </label>
              );
            })}
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              logout();
              navigate("/manager/login");
            }}
          >
            Sign out
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={selected.size === 0 || busy}
          >
            {busy ? "Creating…" : "Create game"}
          </button>
        </div>
      </form>
    </main>
  );
}
