import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EndScreen } from "../components/EndScreen";
import { QRPanel } from "../components/QRPanel";
import { Skeleton } from "../components/Skeleton";
import { useGameChannel } from "../hooks/useGameChannel";
import { useGameSounds } from "../hooks/useGameSounds";
import { serverTimeNow } from "../hooks/useServerTime";
import styles from "./DisplayPage.module.css";

const ANSWER_DURATION_SEC = 10;

const CODE_RE = /^[A-Z2-9]{6}$/;
const CODE_CHAR_RE = /[A-Z2-9]/g;

function normalizeCode(raw: string): string {
  return (raw.toUpperCase().match(CODE_CHAR_RE) ?? []).join("").slice(0, 6);
}

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
    const trimmed = normalizeCode(code);
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
          onChange={(e) => setCode(normalizeCode(e.target.value))}
          placeholder="ABCDEF"
          maxLength={6}
          autoFocus
          required
        />
        <span className={styles.entryCounter} aria-hidden="true">
          {code.length}/6
        </span>
        <button type="submit" className="btn btn-primary" disabled={!CODE_RE.test(code)}>
          Open
        </button>
      </form>
    </main>
  );
}

function DisplayBoard({ gameCode }: { gameCode: string }) {
  const { state, status } = useGameChannel(gameCode);
  const sounds = useGameSounds();
  const [soundOn, setSoundOn] = useState(false);
  const [now, setNow] = useState(() => serverTimeNow().getTime());
  const prevBuzzedRef = useRef<string | null | undefined>(undefined);
  const prevScoresRef = useRef<Record<string, number>>({});
  const prevRoundRef = useRef<number | undefined>(undefined);

  // Tick once a second so the post-buzz countdown re-renders.
  useEffect(() => {
    const id = window.setInterval(() => setNow(serverTimeNow().getTime()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!soundOn || !state) return;
    const game = state.game;

    if (prevBuzzedRef.current !== undefined) {
      if (game.buzzed_team_id != null && prevBuzzedRef.current !== game.buzzed_team_id) {
        sounds.playBuzz();
      }
    }
    prevBuzzedRef.current = game.buzzed_team_id ?? null;

    if (prevRoundRef.current !== undefined && game.round_number > prevRoundRef.current) {
      sounds.playRoundStart();
    }
    prevRoundRef.current = game.round_number;

    let scoreIncreased = false;
    for (const t of state.teams.values()) {
      const prev = prevScoresRef.current[t.id];
      if (prev !== undefined && t.score > prev) scoreIncreased = true;
      prevScoresRef.current[t.id] = t.score;
    }
    if (scoreIncreased) sounds.playAward();
  }, [state, sounds, soundOn]);

  function toggleSound() {
    sounds.prime();
    setSoundOn((s) => !s);
  }

  if (status === "gone") {
    return (
      <main className={styles.shell}>
        <div className={`${styles.banner} ${styles.bannerEnded}`}>Game has ended or expired.</div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className={styles.shell} aria-busy="true">
        <Skeleton height={72} />
        <Skeleton height={96} />
        <div className={styles.skeletonRows}>
          <Skeleton height={88} />
          <Skeleton height={88} />
          <Skeleton height={88} />
        </div>
      </main>
    );
  }

  const game = state.game;
  const teams = Array.from(state.teams.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.joined_at.localeCompare(b.joined_at);
  });
  const lockedTeam = game.buzzed_team_id != null ? state.teams.get(game.buzzed_team_id) : null;

  if (game.status === "ended") {
    return (
      <main className={styles.shell}>
        <EndScreen teams={teams} gameCode={gameCode} />
      </main>
    );
  }

  const roundLabel = game.status === "playing" ? `Round ${game.round_number}` : null;

  let bannerClass = styles.banner;
  let bannerText = "Waiting for the host…";
  if (lockedTeam) {
    bannerClass = `${styles.banner} ${styles.bannerLocked}`;
    bannerText = `${lockedTeam.name} buzzed in!`;
  } else if (roundLabel) {
    bannerText = roundLabel;
  }
  const showRoundSubhead = lockedTeam != null && roundLabel != null;

  const lockedAt = game.locked_at;
  const elapsedSec = lockedAt ? Math.max(0, Math.floor((now - Date.parse(lockedAt)) / 1000)) : 0;
  const remainingSec = Math.max(0, ANSWER_DURATION_SEC - elapsedSec);
  const timerActive = game.status === "playing" && lockedTeam != null && lockedAt != null;
  const timerPct = Math.max(0, Math.min(100, (remainingSec / ANSWER_DURATION_SEC) * 100));

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <h1>Sound Clash</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={`${styles.soundToggle} ${soundOn ? styles.soundOn : ""}`}
            onClick={toggleSound}
            aria-pressed={soundOn}
          >
            <span aria-hidden="true">{soundOn ? "🔊" : "🔇"}</span>
            <span>{soundOn ? "Sound on" : "Enable sound"}</span>
          </button>
          <span className={styles.code}>{gameCode}</span>
        </div>
      </header>

      <div className={bannerClass} role="status" aria-live="polite">
        <span className={styles.bannerText}>{bannerText}</span>
        {showRoundSubhead ? <span className={styles.bannerSubhead}>{roundLabel}</span> : null}
      </div>

      {timerActive ? (
        <div
          className={`${styles.timer} ${remainingSec <= 5 ? styles.timerLow : ""}`}
          style={{ "--timer-pct": `${timerPct}%` } as CSSProperties}
          role="timer"
          aria-label="Time remaining"
        >
          <div className={styles.timerBar}>
            <div className={styles.timerFill} />
          </div>
          <span className={styles.timerValue}>{remainingSec}s</span>
        </div>
      ) : null}

      <div className={styles.scores}>
        {teams.length === 0 ? (
          <div className={styles.emptyBoard}>
            <p className={styles.emptyBoardTitle}>Waiting for teams</p>
            <p className={styles.emptyBoardHint}>Scan to join, or enter the code on your phone.</p>
            <div className={styles.emptyBoardQR}>
              <QRPanel
                gameCode={gameCode}
                joinUrl={`${window.location.origin}/join/${gameCode}`}
                size={280}
              />
            </div>
          </div>
        ) : (
          <ol className={styles.bigList}>
            {teams.map((t, i) => (
              <li
                key={t.id}
                data-team-id={t.id}
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
