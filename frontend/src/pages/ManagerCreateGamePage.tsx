import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Skeleton } from "../components/Skeleton";
import { useToast } from "../context/useToast";
import { createGame, listGenres } from "../lib/api";
import { setManagerToken } from "../lib/managerToken";
import type { Genre } from "../lib/types";
import styles from "./ManagerCreateGamePage.module.css";

export function ManagerCreateGamePage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [genres, setGenres] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [totalRounds, setTotalRounds] = useState(10);
  const [busy, setBusy] = useState(false);
  const [genresLoading, setGenresLoading] = useState(true);

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const game = await createGame({
        total_rounds: totalRounds,
        selected_genres: Array.from(selected),
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
              aria-label="Rounds"
              data-testid="rounds-slider"
            />
            <span className={styles.roundsValue}>{totalRounds}</span>
          </div>
        </div>

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

        <div className={styles.actions}>
          <Link to="/" className="btn btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={selected.size === 0 || busy}>
            {busy ? "Creating…" : "Create game"}
          </button>
        </div>
      </form>
    </main>
  );
}
