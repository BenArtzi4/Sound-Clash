import { useMemo, type CSSProperties } from "react";
import { useCountUp } from "../hooks/useCountUp";
import type { Team } from "../lib/types";
import styles from "./EndScreen.module.css";
import { LaurelIcon } from "./icons";

interface Props {
  teams: Team[];
  gameCode: string;
  // The display's version: the whole screen fits its frame with no scroll
  // (podium beside the leaderboard on a landscape frame). The phones keep the
  // scrolling column. Needs a size container around it (DisplayPage's
  // endFrame), which the CSS sizes everything from.
  fit?: boolean;
}

// The final results screen shows only the top teams so the "who won" moment
// isn't buried under a long list (issue #180). 5 keeps it consistent with the
// live top-5 leaderboard story (#179) and is wide enough that the near-podium
// teams still get their moment.
const TOP_N = 5;

// The podium total rolls up from zero. The shared hook honours reduced motion
// (and jsdom's missing matchMedia) by rendering the final number on first
// paint instead — the global CSS policy can't reach a JS animation.
function Score({ value, delay }: { value: number; delay: number }) {
  const n = useCountUp(value, { from: 0, duration: 900, delay });
  return <>{n}</>;
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
  fit,
}: {
  teams: Team[];
  place: 1 | 2 | 3;
  className: string | undefined;
  startDelayMs: number;
  fit: boolean;
}) {
  const isWinner = place === 1;
  return (
    <div className={`${styles.podiumCard} ${className}`}>
      {isWinner ? (
        <span className={styles.crown} aria-hidden="true">
          <LaurelIcon />
        </span>
      ) : null}
      <div className={styles.medal}>{place}</div>
      {/* Every team sharing this place is listed — a higher-scoring tied team is
          never hidden while a lower-scoring team keeps its own card. The card
          grows to fit them (min-height, no internal scroll — issue #180); a
          realistic tie is a handful of teams. */}
      <div className={styles.podiumTeams}>
        {fit && teams.length > 1 ? (
          // The display's frame can't grow, so a tie lists its names as one
          // wrapped group over the score they share. Each team still has its
          // own row on the leaderboard beside the podium.
          <div className={styles.podiumTeam}>
            <div className={styles.tiedNames}>
              {teams.map((t) => (
                <span key={t.id} className={styles.tiedName} dir="auto">
                  {t.name}
                </span>
              ))}
            </div>
            <div className={styles.teamScore}>
              <Score value={teams[0]!.score} delay={startDelayMs} />
              <span className={styles.scoreUnit}>pts</span>
            </div>
          </div>
        ) : (
          teams.map((t, i) => (
            <div key={t.id} className={styles.podiumTeam}>
              <div className={styles.teamName}>{t.name}</div>
              <div className={styles.teamScore}>
                <Score value={t.score} delay={startDelayMs + i * 150} />
                <span className={styles.scoreUnit}>pts</span>
              </div>
            </div>
          ))
        )}
      </div>
      {isWinner ? (
        <div className={styles.winnerLabel}>{teams.length > 1 ? "WINNERS" : "WINNER"}</div>
      ) : null}
    </div>
  );
}

export function EndScreen({ teams, gameCode, fit = false }: Props) {
  const groups = useMemo(() => groupByScore(teams), [teams]);
  const { visible: scoreboard, hidden: hiddenCount } = useMemo(
    () => capScoreboard(flattenWithRanks(groups)),
    [groups],
  );

  const goldGroup = groups[0];
  const silverGroup = groups[1];
  const bronzeGroup = groups[2];
  const teamCount = teams.length;

  return (
    <div
      className={fit ? `${styles.shell} ${styles.fit}` : styles.shell}
      data-fit={fit || undefined}
    >
      <header className={styles.heading}>
        <span className={styles.trophy} aria-hidden="true">
          <LaurelIcon />
        </span>
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
                fit={fit}
              />
            ) : (
              <div className={styles.podiumPlaceholder} />
            )}

            {goldGroup ? (
              <PodiumCard
                teams={goldGroup}
                place={1}
                className={styles.gold}
                startDelayMs={800}
                fit={fit}
              />
            ) : null}

            {bronzeGroup ? (
              <PodiumCard
                teams={bronzeGroup}
                place={3}
                className={styles.bronze}
                startDelayMs={200}
                fit={fit}
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
            <h2 className={styles.scoreboardTitle}>Leaderboard</h2>
            {/* --rows: the fitted version shrinks the rows when a tie at the cut
                line lists more than five. */}
            <ol
              className={styles.scoreboardList}
              style={{ "--rows": scoreboard.length } as CSSProperties}
            >
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
