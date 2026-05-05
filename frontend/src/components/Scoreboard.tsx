import { useEffect, useRef, useState } from "react";
import type { Team } from "../lib/types";
import styles from "./Scoreboard.module.css";

interface Props {
  teams: Team[];
  buzzedTeamId?: string | null;
}

export function Scoreboard({ teams, buzzedTeamId }: Props) {
  const prevScoresRef = useRef<Record<string, number>>({});
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const changed = new Set<string>();
    for (const t of teams) {
      const prev = prevScoresRef.current[t.id];
      if (prev !== undefined && prev !== t.score) changed.add(t.id);
      prevScoresRef.current[t.id] = t.score;
    }
    if (changed.size === 0) return undefined;
    setFlashingIds((cur) => {
      const next = new Set(cur);
      changed.forEach((id) => next.add(id));
      return next;
    });
    const handle = window.setTimeout(() => setFlashingIds(new Set()), 700);
    return () => window.clearTimeout(handle);
  }, [teams]);

  if (teams.length === 0) {
    return (
      <div className={styles.empty} data-testid="scoreboard-empty">
        <div className={styles.emptyIcon} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className={styles.emptyTitle}>No teams have joined yet</p>
        <p className={styles.emptyHint}>Share the game code — players will appear here as they join.</p>
      </div>
    );
  }

  const sorted = [...teams].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.joined_at.localeCompare(b.joined_at);
  });

  return (
    <ol className={styles.list} data-testid="scoreboard">
      {sorted.map((team, index) => {
        const isBuzzed = team.id === buzzedTeamId;
        const isFlashing = flashingIds.has(team.id);
        const rowClass = [
          styles.row,
          isBuzzed ? styles.buzzed : "",
          isFlashing ? styles.flashing : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={team.id} className={rowClass} data-team-id={team.id}>
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.name}>{team.name}</span>
            <span key={team.score} className={styles.score}>
              {team.score}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
