import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EndScreen } from "../components/EndScreen";
import { PointChange } from "../components/PointChange";
import { QRPanel } from "../components/QRPanel";
import { RoundCountdown } from "../components/RoundCountdown";
import { Skeleton } from "../components/Skeleton";
import { SoundtrackBadge } from "../components/SoundtrackBadge";
import { useGameChannel } from "../hooks/useGameChannel";
import { supabase } from "../lib/supabase";
import { deriveIsSoundtrack, type SongGenreSlugEmbed } from "../lib/soundtrack";
import type { Song } from "../lib/types";
import styles from "./DisplayPage.module.css";

interface PointEvent {
  id: string;
  teamName: string;
  delta: number;
}

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
  const [pointEvents, setPointEvents] = useState<PointEvent[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const prevScoresRef = useRef<Record<string, number>>({});
  const eventSeqRef = useRef(0);

  // Fetch the current round's song so the reveal panel can display the
  // actual title / artist text once the manager confirms a correct answer.
  // Mirrors the lookup in ManagerConsolePage.tsx so all three roles can
  // surface the same metadata after a token is claimed.
  const currentRoundSongId = state?.currentRound?.song_id ?? null;
  useEffect(() => {
    if (!currentRoundSongId) {
      setCurrentSong(null);
      return;
    }
    if (currentSong && currentSong.id === currentRoundSongId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("songs")
        .select("id,title,artist,youtube_id,start_time,song_genres(genres(slug))")
        .eq("id", currentRoundSongId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      // is_soundtrack is derived from genre membership (migration 028 dropped
      // the column), so compute it from the embedded genre slugs.
      const { song_genres, ...base } = data as unknown as Omit<Song, "is_soundtrack" | "genres"> & {
        song_genres: SongGenreSlugEmbed[] | null;
      };
      setCurrentSong({ ...base, is_soundtrack: deriveIsSoundtrack(song_genres) });
    })();
    return () => {
      cancelled = true;
    };
    // currentSong is included via the .id chain; full-object dep would
    // re-run on every render and re-fetch the same song.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoundSongId, currentSong?.id]);

  useEffect(() => {
    if (!state) return;
    const events: PointEvent[] = [];
    for (const t of state.teams.values()) {
      const prev = prevScoresRef.current[t.id];
      if (prev !== undefined && t.score !== prev) {
        eventSeqRef.current += 1;
        events.push({
          id: `${t.id}-${eventSeqRef.current}`,
          teamName: t.name,
          delta: t.score - prev,
        });
      }
      prevScoresRef.current[t.id] = t.score;
    }
    if (events.length > 0) {
      setPointEvents((current) => [...current, ...events]);
    }
  }, [state]);

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

  // Auto-fit the scoreboard to a non-scrolling TV/projector frame (B-1). Past
  // ~8 teams a single 1080p column pushes the lower ranks and the QR footer off
  // the fold, and a projector can't scroll. So we flow the standings into two
  // balanced columns (rank order stays column-major: 1..k down the left, k+1..n
  // down the right — the CSS grid fills column 1 for --rows rows, then column 2)
  // and pick a density tier from how many rows land in the tallest column. The
  // tier drives a fixed, legible per-row height plus matching font/gaps/QR size
  // in DisplayPage.module.css, sized so every row + the QR fit the frame from 2
  // up to 20 teams. Only two columns are ever used; beyond 20 teams rows would
  // start to clip (the frame stays put — it never scrolls).
  const teamCount = teams.length;
  const scoreColumns = teamCount > 8 ? 2 : 1;
  const rowsPerColumn = Math.max(1, Math.ceil(teamCount / scoreColumns));
  const density = rowsPerColumn <= 5 ? "normal" : rowsPerColumn <= 8 ? "compact" : "dense";
  const qrSize = density === "dense" ? 132 : density === "compact" ? 160 : 176;
  const lockedTeam = game.buzzed_team_id != null ? state.teams.get(game.buzzed_team_id) : null;
  const round = state.currentRound;
  const titleClaimedById = round?.title_claimed_by ?? null;
  const artistClaimedById = round?.artist_claimed_by ?? null;
  const titleClaimedByName = titleClaimedById ? state.teams.get(titleClaimedById)?.name : null;
  const artistClaimedByName = artistClaimedById ? state.teams.get(artistClaimedById)?.name : null;
  const isSoundtrackRound = currentSong?.is_soundtrack === true;

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
  const timerActive = game.status === "playing" && lockedTeam != null && lockedAt != null;

  return (
    <main className={styles.shell} data-density={density}>
      <div className={styles.pointStack} aria-live="polite">
        {pointEvents.map((ev) => (
          <PointChange
            key={ev.id}
            teamName={ev.teamName}
            delta={ev.delta}
            onDone={() =>
              setPointEvents((current) => current.filter((existing) => existing.id !== ev.id))
            }
          />
        ))}
      </div>
      <header className={styles.header}>
        <h1>Sound Clash</h1>
        <div className={styles.headerActions}>
          <span className={styles.code}>{gameCode}</span>
        </div>
      </header>

      <div className={bannerClass} role="status" aria-live="polite">
        <span className={styles.bannerText}>{bannerText}</span>
        {showRoundSubhead ? <span className={styles.bannerSubhead}>{roundLabel}</span> : null}
      </div>

      {round && game.status === "playing" && isSoundtrackRound ? (
        <div className={styles.soundtrackBadgeRow}>
          <SoundtrackBadge size="large" />
        </div>
      ) : null}

      {round && game.status === "playing" ? (
        <div className={styles.revealPanel} aria-label="Song reveal">
          {isSoundtrackRound ? (
            <div
              className={`${styles.revealRow} ${titleClaimedById ? styles.revealRowOpen : ""}`}
              data-testid="display-reveal-title"
            >
              <span className={styles.revealIcon} aria-hidden="true">
                🎬
              </span>
              <span className={styles.revealText}>
                {/* Soundtrack rounds ask for the film/show name, which lives in
                    `artist` (title holds the song/clip name). Reveal the answer. */}
                {titleClaimedById && currentSong ? currentSong.artist : "???"}
              </span>
            </div>
          ) : (
            <>
              <div
                className={`${styles.revealRow} ${titleClaimedById ? styles.revealRowOpen : ""}`}
                data-testid="display-reveal-title"
              >
                <span className={styles.revealIcon} aria-hidden="true">
                  🎵
                </span>
                <span className={styles.revealText}>
                  {titleClaimedById && currentSong ? currentSong.title : "???"}
                </span>
              </div>
              <div
                className={`${styles.revealRow} ${artistClaimedById ? styles.revealRowOpen : ""}`}
                data-testid="display-reveal-artist"
              >
                <span className={styles.revealIcon} aria-hidden="true">
                  🎤
                </span>
                <span className={styles.revealText}>
                  {artistClaimedById && currentSong ? currentSong.artist : "???"}
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}

      {round && game.status === "playing" && !isSoundtrackRound ? (
        <div className={styles.tokenChips} aria-label="Round token state">
          <span
            className={`${styles.tokenChip} ${titleClaimedById ? styles.tokenChipClaimed : ""}`}
            data-testid="display-token-title"
          >
            Song {titleClaimedById ? `✓ ${titleClaimedByName ?? "?"}` : "open"}
          </span>
          <span
            className={`${styles.tokenChip} ${artistClaimedById ? styles.tokenChipClaimed : ""}`}
            data-testid="display-token-artist"
          >
            Artist {artistClaimedById ? `✓ ${artistClaimedByName ?? "?"}` : "open"}
          </span>
        </div>
      ) : null}

      {/* Reserve the countdown row's height for the whole playing phase so the
          scoreboard below doesn't jump down the moment a team buzzes and the
          timer appears. The timer itself only renders while a buzz is held. */}
      {game.status === "playing" ? (
        <div className={styles.timerSlot}>
          {timerActive && lockedAt ? (
            <RoundCountdown lockedAt={lockedAt} durationSec={ANSWER_DURATION_SEC} styles={styles} />
          ) : null}
        </div>
      ) : null}

      <div className={styles.scores}>
        {teams.length === 0 ? (
          <div className={styles.emptyBoard}>
            <p className={styles.emptyBoardTitle}>Waiting for teams</p>
            <p className={styles.emptyBoardHint}>Scan the code below or enter it on your phone.</p>
          </div>
        ) : (
          <ol className={styles.bigList} style={{ "--rows": rowsPerColumn } as CSSProperties}>
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

      {/* Always-visible join footer so a late player can scan after the round
          has started. (Hidden on the end-game podium via the early-return
          above when game.status === "ended".) */}
      <footer className={styles.joinFooter}>
        <QRPanel
          gameCode={gameCode}
          joinUrl={`${window.location.origin}/join/${gameCode}`}
          size={qrSize}
        />
      </footer>
    </main>
  );
}
