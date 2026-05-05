import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useGameChannel } from "../hooks/useGameChannel";
import styles from "./DisplayPage.module.css";

const CODE_RE = /^[A-Z2-9]{6}$/;

export function DisplayPage() {
  const { gameCode } = useParams<{ gameCode?: string }>();
  if (!gameCode) {
    return <DisplayEntry />;
  }
  return <DisplayBoard gameCode={gameCode.toUpperCase()} />;
}

function DisplayEntry() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.toUpperCase();
    if (!CODE_RE.test(trimmed)) return;
    navigate(`/display/${trimmed}`);
  }

  return (
    <main className={styles.entry}>
      <form className={styles.entryCard} onSubmit={handleSubmit}>
        <h1>Display</h1>
        <p className="muted">Enter the game code to open a read-only scoreboard.</p>
        <input
          className={styles.entryInput}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="ABCDEF"
          maxLength={6}
          autoFocus
          required
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!CODE_RE.test(code.toUpperCase())}
        >
          Open
        </button>
      </form>
    </main>
  );
}

function DisplayBoard({ gameCode }: { gameCode: string }) {
  const { state, status } = useGameChannel(gameCode);

  if (status === "gone") {
    return (
      <main className={styles.shell}>
        <div className={`${styles.banner} ${styles.bannerEnded}`}>Game has ended or expired.</div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className={styles.shell}>
        <p className="muted">Connecting…</p>
      </main>
    );
  }

  const game = state.game;
  const teams = Array.from(state.teams.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.joined_at.localeCompare(b.joined_at);
  });
  const lockedTeam = game.buzzed_team_id != null ? state.teams.get(game.buzzed_team_id) : null;

  let bannerClass = styles.banner;
  let bannerText = "Waiting for the host…";
  if (game.status === "ended") {
    bannerClass = `${styles.banner} ${styles.bannerEnded}`;
    bannerText = "Game over";
  } else if (lockedTeam) {
    bannerClass = `${styles.banner} ${styles.bannerLocked}`;
    bannerText = `${lockedTeam.name} buzzed in!`;
  } else if (game.status === "playing") {
    bannerText = `Round ${game.round_number} of ${game.total_rounds}`;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <h1>Sound Clash</h1>
        <span className={styles.code}>{gameCode}</span>
      </header>

      <div className={bannerClass}>{bannerText}</div>

      <div className={styles.scores}>
        {teams.length === 0 ? (
          <p className="muted">No teams have joined yet.</p>
        ) : (
          <ol className={styles.bigList}>
            {teams.map((t, i) => (
              <li
                key={t.id}
                className={`${styles.bigRow} ${
                  t.id === game.buzzed_team_id ? styles.bigRowBuzzed : ""
                }`}
              >
                <span className={styles.bigRank}>{i + 1}</span>
                <span className={styles.bigName}>{t.name}</span>
                <span className={styles.bigScore}>{t.score}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </main>
  );
}
