import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Team } from "../lib/types";
import styles from "./EndScreen.module.css";

interface Props {
  teams: Team[];
  gameCode: string;
}

const CONFETTI_COLORS = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const CONFETTI_COUNT = 40;

interface ConfettiPiece {
  x: number;
  delay: number;
  duration: number;
  rotateEnd: number;
  color: string;
  size: number;
}

function generateConfetti(): ConfettiPiece[] {
  const pieces: ConfettiPiece[] = [];
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    pieces.push({
      x: Math.random() * 100,
      delay: Math.random() * 4,
      duration: 3.5 + Math.random() * 2.5,
      rotateEnd: 360 + Math.random() * 720,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
      size: 6 + Math.random() * 8,
    });
  }
  return pieces;
}

function CountUp({
  value,
  duration = 900,
  delay = 0,
}: {
  value: number;
  duration?: number;
  delay?: number;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    let started = false;
    const startTimer = window.setTimeout(() => {
      started = true;
      const start = performance.now();
      const tick = (t: number) => {
        const elapsed = t - start;
        const progress = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplay(Math.round(value * eased));
        if (progress < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(startTimer);
      if (started) cancelAnimationFrame(raf);
    };
  }, [value, duration, delay]);
  return <>{display}</>;
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 64 64" width="80" height="80" aria-hidden="true">
      <defs>
        <linearGradient id="trophy-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      <path
        d="M18 8h28v10c0 8-6 14-14 14s-14-6-14-14V8z"
        fill="url(#trophy-grad)"
        stroke="#92400e"
        strokeWidth="1.5"
      />
      <path
        d="M14 12c-3 0-5 2-5 5s3 6 9 7"
        fill="none"
        stroke="#92400e"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M50 12c3 0 5 2 5 5s-3 6-9 7"
        fill="none"
        stroke="#92400e"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect
        x="28"
        y="32"
        width="8"
        height="10"
        fill="url(#trophy-grad)"
        stroke="#92400e"
        strokeWidth="1.5"
      />
      <rect
        x="20"
        y="42"
        width="24"
        height="6"
        rx="1"
        fill="url(#trophy-grad)"
        stroke="#92400e"
        strokeWidth="1.5"
      />
      <rect
        x="16"
        y="48"
        width="32"
        height="6"
        rx="1"
        fill="url(#trophy-grad)"
        stroke="#92400e"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// Group teams by distinct score, highest first. Teams within a group share a
// rank; game-rules.md §4: "tied teams share the win".
function groupByScore(teams: Team[]): Team[][] {
  const sorted = [...teams].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.joined_at.localeCompare(b.joined_at);
  });
  const groups: Team[][] = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.score === t.score) {
      last.push(t);
    } else {
      groups.push([t]);
    }
  }
  return groups;
}

interface ScoreboardRow {
  team: Team;
  rank: number;
}

// Flatten groups into per-team rows with a dense rank (tied teams share a
// rank, next rank is +1 — matches the podium's group indexing). Used by the
// always-on full scoreboard so every team is individually visible regardless
// of how ties collapse the podium.
function flattenWithRanks(groups: Team[][]): ScoreboardRow[] {
  const rows: ScoreboardRow[] = [];
  groups.forEach((group, i) => {
    const rank = i + 1;
    for (const team of group) {
      rows.push({ team, rank });
    }
  });
  return rows;
}

function PodiumCard({
  teams,
  place,
  className,
  startDelayMs,
}: {
  teams: Team[];
  place: 1 | 2 | 3;
  className: string | undefined;
  startDelayMs: number;
}) {
  const isWinner = place === 1;
  return (
    <div className={`${styles.podiumCard} ${className}`}>
      {isWinner ? (
        <span className={styles.crown} aria-hidden="true">
          ★
        </span>
      ) : null}
      <div className={styles.medal}>{place}</div>
      <div className={styles.podiumTeams}>
        {teams.map((t, i) => (
          <div key={t.id} className={styles.podiumTeam}>
            <div className={styles.teamName}>{t.name}</div>
            <div className={styles.teamScore}>
              <CountUp value={t.score} delay={startDelayMs + i * 150} />
              <span className={styles.scoreUnit}>pts</span>
            </div>
          </div>
        ))}
      </div>
      {isWinner ? (
        <div className={styles.winnerLabel}>{teams.length > 1 ? "WINNERS" : "WINNER"}</div>
      ) : null}
    </div>
  );
}

export function EndScreen({ teams, gameCode }: Props) {
  const groups = useMemo(() => groupByScore(teams), [teams]);
  const scoreboard = useMemo(() => flattenWithRanks(groups), [groups]);
  const confetti = useMemo(() => generateConfetti(), []);

  const goldGroup = groups[0];
  const silverGroup = groups[1];
  const bronzeGroup = groups[2];
  const teamCount = teams.length;

  return (
    <div className={styles.shell}>
      <div className={styles.confettiLayer} aria-hidden="true">
        {confetti.map((p, i) => (
          <span
            key={i}
            className={styles.confettiPiece}
            style={
              {
                left: `${p.x}vw`,
                width: `${p.size}px`,
                height: `${p.size * 1.4}px`,
                background: p.color,
                animationDelay: `${p.delay}s`,
                animationDuration: `${p.duration}s`,
                "--rotate-end": `${p.rotateEnd}deg`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <header className={styles.heading}>
        <TrophyIcon />
        <h1 className={styles.title}>FINAL RESULTS</h1>
        <p className={styles.subtitle}>
          Game <span className={styles.codeText}>{gameCode}</span>
          {teamCount > 0 ? <span className={styles.dot}>·</span> : null}
          {teamCount > 0 ? `${teamCount} ${teamCount === 1 ? "team" : "teams"}` : null}
        </p>
      </header>

      {teamCount === 0 ? (
        <p className={styles.noTeams}>Game ended without any teams.</p>
      ) : (
        <>
          <div className={styles.podium}>
            {silverGroup ? (
              <PodiumCard
                teams={silverGroup}
                place={2}
                className={styles.silver}
                startDelayMs={400}
              />
            ) : (
              <div className={styles.podiumPlaceholder} />
            )}

            {goldGroup ? (
              <PodiumCard teams={goldGroup} place={1} className={styles.gold} startDelayMs={800} />
            ) : null}

            {bronzeGroup ? (
              <PodiumCard
                teams={bronzeGroup}
                place={3}
                className={styles.bronze}
                startDelayMs={200}
              />
            ) : (
              <div className={styles.podiumPlaceholder} />
            )}
          </div>

          {/* Per-team scoreboard. Always rendered so every team is
              individually visible — the podium collapses tied teams onto a
              single card (and renders an invisible placeholder for any
              missing rank), which made it look like teams were dropped
              when scores tied. */}
          <div className={styles.scoreboard} data-testid="final-scoreboard">
            <h2 className={styles.scoreboardTitle}>Full scoreboard</h2>
            <ol className={styles.scoreboardList}>
              {scoreboard.map(({ team, rank }) => (
                <li
                  key={team.id}
                  className={styles.scoreboardRow}
                  data-rank={rank}
                  data-team-id={team.id}
                >
                  <span className={styles.scoreboardRank}>{rank}</span>
                  <span className={styles.scoreboardName}>{team.name}</span>
                  <span className={styles.scoreboardScore}>{team.score}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}

      <p className={styles.thanks}>Thanks for playing!</p>
    </div>
  );
}
