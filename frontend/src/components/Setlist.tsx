import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSetlist } from "../hooks/useSetlist";
import { loadExportFonts } from "../lib/exportFonts";
import {
  buildPlaylistParts,
  buildSongsHtml,
  buildSongsText,
  creditParts,
  exportFileName,
  formatGameDate,
  playlistPartLabel,
  showArtist,
  watchUrl,
  type ExportFonts,
  type ExportSong,
} from "../lib/exportSongs";
import type { ActiveGame, GameRound, Team } from "../lib/types";
import { CheckIcon, CopyIcon, DownloadIcon, PlayIcon, RefreshIcon, ShareIcon } from "./icons";
import styles from "./Setlist.module.css";

interface Props {
  game: ActiveGame;
  rounds: GameRound[];
  teams: Team[];
}

// Rows shown before "Show all": enough to jog the memory without pushing the
// actions a whole screen down on a phone.
export const SETLIST_COLLAPSED_COUNT = 5;

// A phone gets its share sheet (WhatsApp, Messages, "Copy"); a laptop gets a
// plain copy, which is what a desktop user expects from the same button.
function prefersNativeShare(): boolean {
  return (
    typeof navigator.share === "function" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function SetlistRow({ song, index }: { song: ExportSong; index: number }) {
  const credits = creditParts(song);
  const artist = showArtist(song);
  const year = song.release_year;
  return (
    <li className={styles.row} data-testid="setlist-row">
      <span className={styles.num}>{index + 1}</span>
      <div className={styles.main}>
        <p className={styles.titleLine}>
          <span dir="auto">{song.title}</span>
          {song.is_soundtrack ? <span className={styles.tag}>Soundtrack</span> : null}
        </p>
        {artist || year !== null ? (
          <p className={styles.sub}>
            {artist ? <span dir="auto">{song.artist}</span> : null}
            {artist && year !== null ? " · " : null}
            {year !== null ? year : null}
          </p>
        ) : null}
        {credits.length === 0 ? (
          <p className={`${styles.credit} ${styles.creditNone}`}>Nobody got it</p>
        ) : (
          <p className={styles.credit}>
            {credits.map((c, i) => (
              <Fragment key={i}>
                {i > 0 ? " · " : null}
                {c.label ?? "Got it"}: <bdi>{c.team}</bdi>
              </Fragment>
            ))}
          </p>
        )}
      </div>
      <a
        className={styles.play}
        href={watchUrl(song.youtube_id)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Play ${song.title} on YouTube`}
      >
        <PlayIcon />
      </a>
    </li>
  );
}

/**
 * The end-of-game setlist, shown under the final results on the host console
 * and on every player's phone: each song that played with who got it, plus
 * "Play all on YouTube", a share/copy of the plain list (which also pastes into
 * playlist converters for Spotify / Apple Music) and a themed keepsake file.
 * Everything is built in the browser from the game snapshot -- nothing is
 * stored.
 */
export function Setlist({ game, rounds, teams }: Props) {
  const { status, songs, retry } = useSetlist(rounds, teams);
  const [expanded, setExpanded] = useState(false);
  const [fonts, setFonts] = useState<ExportFonts>({});
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);
  const nativeShare = useMemo(() => prefersNativeShare(), []);

  // Warm the embedded fonts now so "Save as file" is instant and stays inside
  // the tap's user activation (Safari is strict about late downloads).
  useEffect(() => {
    let alive = true;
    void loadExportFonts().then((f) => {
      if (alive) setFonts(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    },
    [],
  );

  const parts = useMemo(() => buildPlaylistParts(songs.map((s) => s.youtube_id)), [songs]);
  const ready = status === "ready" && songs.length > 0;
  const visible = expanded ? songs : songs.slice(0, SETLIST_COLLAPSED_COUNT);
  const dateLabel = formatGameDate(game.started_at);

  function flash(next: "copied" | "failed") {
    setCopyState(next);
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2500);
  }

  async function shareList() {
    const text = buildSongsText(songs);
    if (nativeShare) {
      try {
        await navigator.share({ title: `Sound Clash setlist · ${dateLabel}`, text });
        return;
      } catch (err) {
        // Closing the sheet is a choice, not a failure. Anything else (no
        // share target, permission) falls through to a plain copy.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("copied");
    } catch {
      flash("failed");
    }
  }

  function saveFile() {
    const sorted = [...teams].sort(
      (a, b) => b.score - a.score || a.joined_at.localeCompare(b.joined_at),
    );
    const html = buildSongsHtml(
      { dateLabel, teams: sorted.map((t) => ({ name: t.name, score: t.score })) },
      songs,
      fonts,
    );
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(new Date(game.started_at));
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking in the same tick can abort the download in Safari; hold the URL
    // for a minute (FileSaver.js does the same).
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <section className={styles.setlist} aria-labelledby="setlist-heading" data-testid="setlist">
      <header className={styles.header}>
        <h2 id="setlist-heading" className={styles.heading}>
          Setlist
        </h2>
        {status === "ready" && songs.length > 0 ? (
          <p className={styles.count}>
            {songs.length} {songs.length === 1 ? "song" : "songs"}
          </p>
        ) : null}
      </header>

      {status === "loading" ? (
        <p className={styles.note} role="status">
          Loading the songs…
        </p>
      ) : null}
      {status === "error" ? (
        <div className={styles.error} role="alert">
          <p>Couldn't load the songs.</p>
          <button type="button" className="btn" onClick={retry} data-testid="setlist-retry">
            <RefreshIcon /> Retry
          </button>
        </div>
      ) : null}
      {status === "ready" && songs.length === 0 ? (
        <p className={styles.note}>No songs were played.</p>
      ) : null}

      {songs.length > 0 ? (
        <>
          <ol className={styles.list}>
            {visible.map((s, i) => (
              <SetlistRow key={s.round_number} song={s} index={i} />
            ))}
          </ol>
          {songs.length > SETLIST_COLLAPSED_COUNT ? (
            <button
              type="button"
              className={`btn btn-ghost ${styles.more}`}
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              data-testid="setlist-toggle"
            >
              {expanded ? "Show fewer" : `Show all ${songs.length} songs`}
            </button>
          ) : null}
        </>
      ) : null}

      <div className={styles.actions}>
        {ready ? (
          parts.map((p, i) => (
            <a
              key={p.from}
              className={`btn ${styles.action}`}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={i === 0 ? "export-playlist" : `export-playlist-${i + 1}`}
            >
              <PlayIcon /> {playlistPartLabel(p, parts.length)}
            </a>
          ))
        ) : (
          <button
            type="button"
            className={`btn ${styles.action}`}
            disabled
            data-testid="export-playlist"
          >
            <PlayIcon /> Play all on YouTube
          </button>
        )}
        <button
          type="button"
          className={`btn ${styles.action}`}
          onClick={() => void shareList()}
          disabled={!ready}
          data-testid="export-share"
        >
          {copyState === "copied" ? (
            <>
              <CheckIcon /> Copied
            </>
          ) : nativeShare ? (
            <>
              <ShareIcon /> Share list
            </>
          ) : (
            <>
              <CopyIcon /> Copy list
            </>
          )}
        </button>
        <button
          type="button"
          className={`btn ${styles.action}`}
          onClick={saveFile}
          disabled={!ready}
          data-testid="export-download"
        >
          <DownloadIcon /> Save as file
        </button>
      </div>

      {copyState === "failed" ? (
        <p className={styles.fail} role="status">
          Couldn't copy the list. Save it as a file instead.
        </p>
      ) : null}
      {ready ? (
        <p className={styles.hint}>
          Want it on Spotify or Apple Music? Paste the list into{" "}
          <a
            href="https://www.tunemymusic.com/transfer/freetext-to-spotify"
            target="_blank"
            rel="noopener noreferrer"
          >
            TuneMyMusic
          </a>{" "}
          — in the Spotify app it's Your Library{"\u00a0"}→{"\u00a0"}Import your music.
        </p>
      ) : null}
    </section>
  );
}
