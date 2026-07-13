import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EndScreen } from "../components/EndScreen";
import { PointChange } from "../components/PointChange";
import { QRPanel } from "../components/QRPanel";
import { RoundCountdown } from "../components/RoundCountdown";
import { Skeleton } from "../components/Skeleton";
import { SoundtrackBadge } from "../components/SoundtrackBadge";
import { useGameChannel } from "../hooks/useGameChannel";
import { fetchSongById } from "../lib/songMetadata";
import type { Song, Team } from "../lib/types";
import styles from "./DisplayPage.module.css";

interface PointEvent {
  id: string;
  teamName: string;
  delta: number;
}

const ANSWER_DURATION_SEC = 10;

// Issue #179: the public board shows only the top 5 teams so the "who's
// winning" story stays readable across a room. Every team that falls off the
// board keeps its own place + score on its phone (see TeamGameplayPage).
const MAX_BOARD_TEAMS = 5;

const CODE_RE = /^[A-Z2-9]{6}$/;
const CODE_CHAR_RE = /[A-Z2-9]/g;

function normalizeCode(raw: string): string {
  return (raw.toUpperCase().match(CODE_CHAR_RE) ?? []).join("").slice(0, 6);
}

// Dense ranks over score-sorted teams: teams tied on score share a place (…,2,2,4
// → returned as 2,2,3 dense) and the next distinct score is +1. Matches the
// final EndScreen so a team's rank/medal doesn't visibly renumber the instant
// the game ends (game-rules.md §4: "tied teams share the win").
function denseRanks(teams: Team[]): number[] {
  const ranks: number[] = [];
  let rank = 0;
  let prevScore: number | null = null;
  for (const t of teams) {
    if (prevScore === null || t.score !== prevScore) {
      rank += 1;
      prevScore = t.score;
    }
    ranks.push(rank);
  }
  return ranks;
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
  const { state, status, finalBoard } = useGameChannel(gameCode);
  const [pointEvents, setPointEvents] = useState<PointEvent[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  // Track the frame height so the QR footer can shrink on short / OS-scaled
  // laptop displays instead of starving the scoreboard (the CSS grid already
  // shrinks the rows to fit, but a 220px QR block on a 720px frame left the
  // standings almost no room).
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== "undefined" ? window.innerHeight : 1080,
  );
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
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
    // fetchSongById retries transient failures with bounded backoff (F-P1-7)
    // so one blip doesn't blank the reveal for the whole round.
    void fetchSongById(currentRoundSongId, () => cancelled).then((song) => {
      if (cancelled || !song) return;
      setCurrentSong(song);
    });
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
    // The final scoreboard survives the delete (I-FinalBoard): render the
    // podium from the hook's last-known snapshot with a "gone" banner on top.
    // No snapshot (this screen never saw the live game — e.g. it opened
    // straight onto an already-swept code) falls back to the bare banner.
    return (
      <main className={styles.shell}>
        <div className={`${styles.banner} ${styles.bannerEnded}`}>Game has ended or expired.</div>
        {finalBoard ? (
          <EndScreen teams={Array.from(finalBoard.teams.values())} gameCode={gameCode} />
        ) : null}
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
  const rankedTeams = Array.from(state.teams.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.joined_at.localeCompare(b.joined_at);
  });
  // Only the top 5 make the board (issue #179); the rest keep their standing on
  // their own phones. A ≤5-row board always fits a non-scrolling TV/projector
  // frame as a single roomy "normal"-density column, so the old two-column
  // auto-fit that packed up to 20 teams onto a projector is no longer needed.
  const teams = rankedTeams.slice(0, MAX_BOARD_TEAMS);
  const boardRanks = denseRanks(teams);
  const hiddenTeamCount = rankedTeams.length - teams.length;
  const density = "normal";
  const rowsPerColumn = Math.max(1, teams.length);
  // QR shrinks on shorter (often OS-scaled) laptop frames so the footer doesn't
  // starve the scoreboard; on a tall projector it stays large and scannable.
  const qrSize =
    viewportHeight < 700 ? 96 : viewportHeight < 820 ? 118 : viewportHeight < 950 ? 140 : 172;
  const lockedTeam = game.buzzed_team_id != null ? state.teams.get(game.buzzed_team_id) : null;
  const round = state.currentRound;
  const titleClaimedById = round?.title_claimed_by ?? null;
  const artistClaimedById = round?.artist_claimed_by ?? null;
  const titleClaimedByName = titleClaimedById ? state.teams.get(titleClaimedById)?.name : null;
  const artistClaimedByName = artistClaimedById ? state.teams.get(artistClaimedById)?.name : null;
  const isSoundtrackRound = currentSong?.is_soundtrack === true;

  if (game.status === "ended") {
    // Prefer the snapshot's teams: once the post-end sweep begins
    // cascade-deleting team rows, live `state` shrinks team by team while the
    // snapshot holds the full final board (I-FinalBoard). EndScreen re-sorts,
    // so an unsorted Map dump is fine.
    const boardTeams = finalBoard ? Array.from(finalBoard.teams.values()) : teams;
    return (
      <main className={styles.shell}>
        <EndScreen teams={boardTeams} gameCode={gameCode} />
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
            {teams.map((t, i) => {
              const rank = boardRanks[i]!;
              // Podium colors follow the dense place (tied teams share a color) —
              // but only once a team has actually scored, so the board doesn't
              // hand out medals while everyone is still tied at 0 at the start.
              const medal =
                t.score > 0 && rank <= 3
                  ? [styles.bigRowGold, styles.bigRowSilver, styles.bigRowBronze][rank - 1]
                  : "";
              return (
                <li
                  key={t.id}
                  data-team-id={t.id}
                  data-rank={rank}
                  className={`${styles.bigRow} ${medal} ${
                    t.id === game.buzzed_team_id ? styles.bigRowBuzzed : ""
                  }`}
                >
                  <span className={styles.bigRank}>{rank}</span>
                  <span className={styles.bigName}>{t.name}</span>
                  <span className={styles.bigScore}>{t.score}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {/* Everyone below the top 5 is off the board but still in the game — name
          how many so the room knows the standings run deeper than what's shown.
          Their own place + score lives on their phone (issue #179). */}
      {hiddenTeamCount > 0 ? (
        <p className={styles.moreTeams} data-testid="more-teams">
          +{hiddenTeamCount} more {hiddenTeamCount === 1 ? "team" : "teams"} playing
        </p>
      ) : null}

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
