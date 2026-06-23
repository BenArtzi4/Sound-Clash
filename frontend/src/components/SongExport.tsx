import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  buildSongsHtml,
  buildYouTubePlaylistUrl,
  isPlaylistTruncated,
  YT_PLAYLIST_MAX,
  type ExportMeta,
  type ExportSong,
} from "../lib/exportSongs";
import type { ActiveGame, GameRound, Team } from "../lib/types";
import styles from "./SongExport.module.css";

interface Props {
  game: ActiveGame;
  rounds: GameRound[];
  teams: Team[];
}

// The subset of song columns the export needs (no genres, no soundtrack
// derivation -- just the catalog facts).
interface SongRow {
  id: string;
  title: string;
  artist: string;
  youtube_id: string;
}

/**
 * End-of-game export of the songs that played, shown on the manager console's
 * post-game screen (host-only -- the page is already gated on the manager
 * token). The round history is already in `state.rounds`; this resolves the
 * played song_ids to title/artist/youtube_id with one batch read of the
 * anon-readable `songs` table, then offers a YouTube playlist link and a
 * downloadable HTML file. No backend involvement.
 */
export function SongExport({ game, rounds, teams }: Props) {
  // Played rounds in play order. Narrow song_id to string so downstream code
  // doesn't juggle nulls. Rebuilt each render; songIdsKey below is the stable
  // signature the fetch effect actually reacts to.
  const playedRounds = useMemo(
    () =>
      [...rounds]
        .filter((r): r is GameRound & { song_id: string } => r.song_id !== null)
        .sort((a, b) => a.round_number - b.round_number),
    [rounds],
  );
  const songIdsKey = playedRounds.map((r) => `${r.round_number}:${r.song_id}`).join(",");

  const [songs, setSongs] = useState<ExportSong[] | null>(null);

  useEffect(() => {
    const ids = [...new Set(playedRounds.map((r) => r.song_id))];
    if (ids.length === 0) {
      setSongs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("songs")
        .select("id,title,artist,youtube_id")
        .in("id", ids);
      if (cancelled) return;
      if (error || !data) {
        setSongs([]);
        return;
      }
      const byId = new Map((data as unknown as SongRow[]).map((s) => [s.id, s]));
      const resolved: ExportSong[] = [];
      for (const r of playedRounds) {
        const s = byId.get(r.song_id);
        if (s) {
          resolved.push({
            round_number: r.round_number,
            title: s.title,
            artist: s.artist,
            youtube_id: s.youtube_id,
          });
        }
      }
      setSongs(resolved);
    })();
    return () => {
      cancelled = true;
    };
    // playedRounds is a fresh array each render (the channel hook resyncs every
    // ~20s); songIdsKey is the content signature we want to fetch on. Mirrors the
    // current-song effect's dependency handling in ManagerConsolePage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songIdsKey]);

  function buildMeta(): ExportMeta {
    const sorted = [...teams].sort((a, b) => b.score - a.score);
    return {
      gameCode: game.game_code,
      dateLabel: new Date(game.started_at).toLocaleString(),
      teams: sorted.map((t) => ({ name: t.name, score: t.score })),
    };
  }

  function openPlaylist() {
    if (!songs || songs.length === 0) return;
    const url = buildYouTubePlaylistUrl(songs.map((s) => s.youtube_id));
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function downloadHtml() {
    if (!songs || songs.length === 0) return;
    const html = buildSongsHtml(buildMeta(), songs);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sound-clash-${game.game_code}-songs.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const loading = songs === null;
  const empty = songs !== null && songs.length === 0;
  const disabled = loading || empty;

  return (
    <section className={styles.export} aria-label="Export songs that played">
      <div className={styles.buttons}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={downloadHtml}
          disabled={disabled}
          data-testid="export-download"
        >
          Download song list (HTML)
        </button>
        <button
          type="button"
          className="btn"
          onClick={openPlaylist}
          disabled={disabled}
          data-testid="export-playlist"
        >
          Open as YouTube playlist
        </button>
      </div>
      {loading ? <p className={styles.note}>Preparing export…</p> : null}
      {empty ? <p className={styles.note}>No songs to export.</p> : null}
      {songs && isPlaylistTruncated(songs.length) ? (
        <p className={styles.note}>
          The playlist link opens the first {YT_PLAYLIST_MAX} songs (YouTube’s limit); the
          downloaded file lists all {songs.length}.
        </p>
      ) : null}
    </section>
  );
}
