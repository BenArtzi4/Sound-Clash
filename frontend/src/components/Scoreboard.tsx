import type { Team } from "../lib/types";
import styles from "./Scoreboard.module.css";

interface Props {
  teams: Team[];
  buzzedTeamId?: string | null;
}

export function Scoreboard({ teams, buzzedTeamId }: Props) {
  if (teams.length === 0) {
    return <p className={styles.empty}>No teams have joined yet.</p>;
  }

  const sorted = [...teams].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.joined_at.localeCompare(b.joined_at);
  });

  return (
    <ol className={styles.list} data-testid="scoreboard">
      {sorted.map((team, index) => {
        const isBuzzed = team.id === buzzedTeamId;
        return (
          <li
            key={team.id}
            className={`${styles.row} ${isBuzzed ? styles.buzzed : ""}`}
            data-team-id={team.id}
          >
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.name}>{team.name}</span>
            <span className={styles.score}>{team.score}</span>
          </li>
        );
      })}
    </ol>
  );
}
