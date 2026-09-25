import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExportSong } from "../lib/exportSongs";
import { fetchSongsByIds, type CatalogSong } from "../lib/songMetadata";
import type { GameRound, Team } from "../lib/types";

export type SetlistStatus = "loading" | "ready" | "error";

// Shown for a claim whose team is no longer on the board (kicked mid-game).
export const DEPARTED_TEAM = "A team that left";

/**
 * The songs a finished game played, in round order, each with the team names
 * that claimed its title and artist. The round history and claims already sit
 * in the game snapshot every client holds (useGameChannel); this resolves the
 * played song_ids against the durable, anon-readable `songs` catalog in one
 * batch read, so it still works after the ephemeral game rows are swept.
 */
export function useSetlist(
  rounds: GameRound[],
  teams: Team[],
): { status: SetlistStatus; songs: ExportSong[]; retry: () => void } {
  const playedRounds = useMemo(
    () =>
      [...rounds]
        .filter((r): r is GameRound & { song_id: string } => r.song_id !== null)
        .sort((a, b) => a.round_number - b.round_number),
    [rounds],
  );
  // The lookup only depends on WHICH songs played. The channel hook hands over
  // a fresh rounds array on every resync, so key the fetch on content.
  const songIdsKey = [...new Set(playedRounds.map((r) => r.song_id))].sort().join(",");

  const [catalog, setCatalog] = useState<Map<string, CatalogSong> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ids = songIdsKey === "" ? [] : songIdsKey.split(",");
    if (ids.length === 0) {
      setCatalog(new Map());
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    void fetchSongsByIds(ids, () => cancelled).then((map) => {
      if (cancelled) return;
      if (map) setCatalog(map);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [songIdsKey, attempt]);

  const teamNames = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams]);

  const songs = useMemo((): ExportSong[] => {
    if (!catalog) return [];
    const nameOf = (id: string | null) =>
      id === null ? null : (teamNames.get(id) ?? DEPARTED_TEAM);
    const out: ExportSong[] = [];
    for (const r of playedRounds) {
      const s = catalog.get(r.song_id);
      if (!s) continue;
      out.push({
        round_number: r.round_number,
        title: s.title,
        artist: s.artist,
        youtube_id: s.youtube_id,
        release_year: s.release_year,
        is_soundtrack: s.is_soundtrack,
        title_by: nameOf(r.title_claimed_by),
        artist_by: nameOf(r.artist_claimed_by),
      });
    }
    return out;
  }, [catalog, playedRounds, teamNames]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const status: SetlistStatus = catalog !== null ? "ready" : failed ? "error" : "loading";
  return { status, songs, retry };
}
