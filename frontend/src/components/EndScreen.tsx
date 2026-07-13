import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Team } from "../lib/types";
import styles from "./EndScreen.module.css";

interface Props {
  teams: Team[];
  gameCode: string;
}

const CONFETTI_COLORS = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
const CONFETTI_COUNT = 40;

// The final results screen shows only the top teams so the "who won" moment
// isn't buried under a long list (issue #180). 5 keeps it consistent with the
// live top-5 leaderboard story (#179) and is wide enough that the near-podium
// teams still get their moment.
const TOP_N = 5;

// The score count-up is a JS animation, so the global CSS prefers-reduced-motion
// policy (styles.css) can't reach it — honour the preference here directly.
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    // Reduced-motion users get the final number immediately, no roll-up.
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
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
// rank, next rank is +1 — matches the podium's group indexing). Feeds the
// top-N scoreboard so every listed team is individually visible regardless of
// how ties collapse the podium.
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

// Cap the dense-ranked rows to the top TOP_N teams for the final screen. A tie
// straddling the cut line is never split: if the TOP_N-th team shares a rank
// with the next one, the whole tied group is kept (they're all tied for that
// place — game-rules.md §4). Everything beyond is summarized as "…and N more".
function capScoreboard(rows: ScoreboardRow[]): {
  visible: ScoreboardRow[];
  hidden: number;
} {
  if (rows.length <= TOP_N) return { visible: rows, hidden: 0 };
  let cut = TOP_N;
  const boundaryRank = rows[TOP_N - 1]!.rank;
  while (cut < rows.length && rows[cut]!.rank === boundaryRank) cut++;
  return { visible: rows.slice(0, cut), hidden: rows.length - cut };
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
      {/* Every team sharing this place is listed — a higher-scoring tied team is
          never hidden while a lower-scoring team keeps its own card. The card
          grows to fit them (min-height, no internal scroll — issue #180); a
          realistic tie is a handful of teams. */}
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
  const { visible: scoreboard, hidden: hiddenCount } = useMemo(
    () => capScoreboard(flattenWithRanks(groups)),
    [groups],
  );
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

          {/* Top-N standings. Capped to the top teams (issue #180) so the
              podium's "who won" moment isn't buried under a long list. Still
              renders every top team individually — the podium collapses tied
              teams onto a single card, which made it look like teams were
              dropped when scores tied; this guarantees each is visible. Any
              teams below the cut line are summarized as "…and N more". */}
          <div className={styles.scoreboard} data-testid="final-scoreboard">
            <h2 className={styles.scoreboardTitle}>
              {hiddenCount > 0 ? "Top teams" : "Final standings"}
            </h2>
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
            {hiddenCount > 0 ? (
              <p className={styles.scoreboardMore} data-testid="final-scoreboard-more">
                …and {hiddenCount} more {hiddenCount === 1 ? "team" : "teams"}
              </p>
            ) : null}
          </div>
        </>
      )}

      <p className={styles.thanks}>Thanks for playing!</p>
    </div>
  );
}
