import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useToast } from "../context/useToast";
import { ApiError, endGame } from "../lib/api";
import {
  awardAttemptDirect,
  awardBonusDirect,
  extendGameDirect,
  releaseBuzzLockDirect,
  RpcError,
} from "./useManagerActions";
import { selectNextSongDirect } from "./useSelectNextSong";
import { clearManagerToken } from "../lib/managerToken";
import {
  ARTIST_POINTS,
  BONUS_POINTS,
  SOUNDTRACK_POINTS,
  TITLE_POINTS,
  WRONG_BUZZ_PENALTY,
} from "../lib/scoring";
import { failScore, log, markScoreStart } from "../lib/telemetry";
import { fetchSongById } from "../lib/songMetadata";
import type { GameState, Song, Team } from "../lib/types";
import type { HostPlayer } from "./useHostPlayer";

// Extracted from ManagerConsolePage (T7.2). Owns the manager scoring + round
// actions: the direct-RPC calls (award_attempt / release_buzz_lock /
// select_next_song / extend_game / award_manager_bonus) and the FastAPI-routed end,
// the optimistic-toast-then-await ordering, the per-action in-flight guards, and
// the pending-flag handoffs that bridge the RPC → Realtime gap. handleNextRound
// drives the host's player through the HostPlayer surface passed in.

interface ScoreReceipt {
  team: Team;
  pending: { points: number }[];
  confirmed: number | null;
  overlapping: boolean;
}

export interface Scoring {
  currentSong: Song | null;
  advancingRound: boolean;
  scoreFeedback: { name: string; total: number; pending: string | null } | null;
  busy: boolean;
  endConfirmOpen: boolean;
  setEndConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  bonusOpen: boolean;
  setBonusOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pendingTitle: number | null;
  pendingArtist: number | null;
  pendingWrong: number | null;
  pendingContinue: number | null;
  pendingExtendFor: string | null;
  handleCorrectTitle: () => Promise<void>;
  handleCorrectArtist: () => Promise<void>;
  handleCorrectSoundtrack: () => Promise<void>;
  handleContinueRound: () => Promise<void>;
  handleWrong: () => Promise<void>;
  handleNextRound: () => Promise<void>;
  handleExtendGame: () => Promise<void>;
  handleBonus: (teamId: string, teamName: string) => Promise<void>;
  performEnd: () => Promise<void>;
}

export function useScoring(
  gameCode: string,
  managerToken: string | null,
  state: GameState | null,
  playerReady: boolean,
  hostPlayer: HostPlayer,
  refreshGame: () => Promise<void>,
): Scoring {
  const { toast } = useToast();
  const {
    livePlayer,
    peekedRef,
    peekEpochRef,
    optimisticSongIdRef,
    loadSongIntoPlayer,
    clearSongStart,
    beginSongStart,
    beginRoundCommit,
    endRoundCommit,
  } = hostPlayer;

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [advancingRound, setAdvancingRound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const bonusInFlight = useRef(false);
  const [receipt, setReceipt] = useState<ScoreReceipt | null>(null);

  const liveTeam = receipt && state?.teams.get(receipt.team.id);
  const sameTeamRow = liveTeam === receipt?.team;
  const pendingPoints = receipt?.pending.reduce((sum, award) => sum + award.points, 0) ?? 0;
  const scoreFeedback =
    receipt && liveTeam
      ? {
          name: liveTeam.name,
          total: (sameTeamRow ? receipt.confirmed : null) ?? liveTeam.score,
          pending: receipt.pending.length
            ? sameTeamRow
              ? `${pendingPoints > 0 ? "+" : ""}${pendingPoints} pending`
              : "Confirming score"
            : null,
        }
      : null;

  function beginScore(teamId: string, points: number) {
    const team = state?.teams.get(teamId);
    const award = { points };
    if (team) {
      setReceipt((previous) => {
        if (previous?.team.id !== teamId) {
          return { team, pending: [award], confirmed: null, overlapping: false };
        }
        const sameRow = previous.team === team;
        // Team rows and RPC replies have no shared version. During overlapping
        // awards, let the live rows advance the total in order.
        const overlapping =
          previous.pending.length > 0 ||
          (sameRow && (previous.overlapping || previous.confirmed !== null));
        return {
          team,
          pending: [...previous.pending, award],
          confirmed: sameRow ? previous.confirmed : null,
          overlapping,
        };
      });
    }
    return (total: number | null) =>
      setReceipt((current) => {
        if (!current?.pending.includes(award)) return current;
        return {
          ...current,
          pending: current.pending.filter((item) => item !== award),
          confirmed: current.overlapping ? current.confirmed : total,
        };
      });
  }

  // Pending actions belong to the observed lock. A new buzz can replace it
  // before an older request has returned.
  const [pendingTitle, setPendingTitle] = useState<number | null>(null);
  const [pendingArtist, setPendingArtist] = useState<number | null>(null);
  const [pendingWrong, setPendingWrong] = useState<number | null>(null);
  const [pendingContinue, setPendingContinue] = useState<number | null>(null);
  // Extend-game handoff, same shape as the flags above but keyed on the
  // expires_at value the click happened on: the banner's button stays disabled
  // until the Realtime UPDATE lands with the bumped value (at which point the
  // flag is stale and inert). Cleared on failure so the host can retry.
  const [pendingExtendFor, setPendingExtendFor] = useState<string | null>(null);

  // Synchronous in-flight locks, one PER ACTION. These are the sole guard
  // against a same-action double-fire now that the shared `busy` gate is off
  // the hot handlers (removing it is what stops a *distinct* second click --
  // e.g. Correct Song then quickly Wrong -- from being silently dropped inside
  // the first action's window; see F-P1-8 / F-P2-2). useState can't do this
  // job: `busy` is captured in the closure at render time, so two clicks in
  // one React tick both read the stale value; useRef.current mutates
  // synchronously, so the second same-action click sees `true` and bails.
  // Matters most for handleNextRound, where a duplicate fire would insert an
  // orphan game_rounds row (the other actions are idempotent via the SQL
  // function's already-claimed / no-buzz-to-score branches).
  const titleInFlightRef = useRef<number | null>(null);
  const artistInFlightRef = useRef<number | null>(null);
  const wrongInFlightRef = useRef<number | null>(null);
  const continueInFlightRef = useRef<number | null>(null);
  const nextRoundInFlightRef = useRef(false);
  const lastCommittedRoundRef = useRef(0);
  const extendInFlightRef = useRef(false);

  const attemptId = state?.game.buzz_attempt_id ?? null;
  const latestGame = useRef(state?.game);
  useLayoutEffect(() => {
    latestGame.current = state?.game;
  }, [state?.game]);

  // Pause on every winning buzz, including a new lock by the same team.
  useLayoutEffect(() => {
    if (state?.game.buzzed_team_id != null) {
      livePlayer()?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.game.buzzed_team_id, attemptId]);

  // A new round discards pending feedback for the previous round.
  const currentRoundId = state?.currentRound?.id ?? null;
  useEffect(() => {
    setPendingTitle(null);
    setPendingArtist(null);
    setPendingWrong(null);
    setPendingContinue(null);
    // The round advanced (or reset): any optimistic Next-round prediction has
    // now either landed or is moot, so drop the suppression id.
    optimisticSongIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoundId]);

  // After a manager-tab refresh mid-round, currentSong is null but the round
  // row still has a song_id. Resolve it and push it into the player so the
  // host can keep playing. A local Next/Start already owns the load, even
  // when Realtime arrives before the RPC response.
  const currentRoundSongId = state?.currentRound?.song_id ?? null;
  useEffect(() => {
    if (!currentRoundSongId || advancingRound) return;
    if (currentSong && currentSong.id === currentRoundSongId) return;
    // I-NextMeta: currentSong is the optimistically-committed next song, ahead of
    // the round that hasn't advanced yet — NOT a stale leftover. Don't refetch
    // the old round's song (which would also reload it over the promoted player);
    // the round will catch up momentarily and the RPC reconciles the metadata.
    if (currentSong && currentSong.id === optimisticSongIdRef.current) return;
    let cancelled = false;
    // fetchSongById retries transient failures with bounded backoff (F-P1-7)
    // so one blip doesn't leave the post-refresh player empty for the round.
    // It asks the game-scoped round_song RPC (mig 053), so it needs the code.
    void fetchSongById(gameCode, currentRoundSongId, () => cancelled).then((song) => {
      if (cancelled || !song || nextRoundInFlightRef.current) return;
      setCurrentSong(song);
      loadSongIntoPlayer(song, latestGame.current?.buzzed_team_id != null);
    });
    return () => {
      cancelled = true;
    };
    // Re-run when the round's song changes or the player becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoundSongId, currentSong?.id, playerReady, advancingRound]);

  // no_more_songs before round 1 means the game's mix never had a song (the
  // create page now blocks that, issue #375, but a game made before it, or
  // while the counts were unavailable, can still get here). "All played" is
  // only true once a round has been played.
  function noMoreSongsMessage(): string {
    if ((state?.game.round_number ?? 0) === 0) {
      return "No songs match this game's genres and decades. Start a new game with more genres or Any year.";
    }
    return "All songs in your selected genres have been played. End the game or start a new one with more genres.";
  }

  function reportError(err: unknown) {
    if (err instanceof ApiError) {
      const reason =
        err.details && typeof err.details === "object" && err.details !== null
          ? (err.details as { reason?: unknown }).reason
          : undefined;
      if (err.status === 409 && reason === "no_more_songs") {
        toast(noMoreSongsMessage(), { variant: "error" });
        return;
      }
    }
    if (err instanceof RpcError) {
      // PL/pgSQL RAISE EXCEPTION '<code>' lands as message = '<code>'.
      // 'no_buzz_to_score' / 'title_already_claimed' just mean the click was
      // a no-op (Realtime already cleared the lock or claimed the token);
      // don't spook the host with an error toast.
      if (
        err.message === "no_buzz_to_score" ||
        err.message === "title_already_claimed" ||
        err.message === "artist_already_claimed"
      ) {
        return;
      }
      // 'no_more_songs' is the friendly user-facing error from select_next_song
      // when the selected-genres pool is exhausted. Mirror the ApiError text
      // above so the manager sees the same wording regardless of which path
      // surfaced it.
      if (err.message === "no_more_songs") {
        toast(noMoreSongsMessage(), { variant: "error" });
        return;
      }
      if (err.message === "stale_buzz" || err.message === "round_already_ended") {
        toast("That buzz changed. Check the current team before scoring.", { variant: "info" });
        void refreshGame();
        return;
      }
      if (err.message === "stale_round") {
        toast("The round already advanced. The console is catching up.", { variant: "info" });
        return;
      }
      if (err.message === "song_no_longer_eligible") {
        toast("That song is no longer available. Tap Next round to try again.", {
          variant: "info",
        });
        return;
      }
      log("error", "manager_rpc_failed", { message: err.message });
      toast(err.message, { variant: "error" });
      return;
    }
    log("error", "manager_action_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    toast(err instanceof Error ? err.message : "Request failed", { variant: "error" });
  }

  async function applyAttempt(
    roundId: string,
    buzzAttempt: number,
    expected: number,
    flags: { title_correct: boolean; artist_correct: boolean; wrong_buzz: boolean },
  ): Promise<void> {
    const teamId = state?.game.buzzed_team_id;
    if (!managerToken || !teamId) return;
    const finish = beginScore(teamId, expected);
    try {
      const result = await awardAttemptDirect(gameCode, managerToken, roundId, buzzAttempt, flags);
      finish(result.team_id === teamId ? result.team_total_score : null);
    } catch (err) {
      finish(null);
      throw err;
    }
  }

  function buzzedTeamName(): string | null {
    if (!state) return null;
    const tid = state.game.buzzed_team_id;
    if (!tid) return null;
    return state.teams.get(tid)?.name ?? null;
  }

  async function handleCorrectTitle() {
    if (titleInFlightRef.current === attemptId) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id || attemptId === null) return;
    titleInFlightRef.current = attemptId;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+${TITLE_POINTS} to ${teamName} pending`, { variant: "info" });
    // Pending flag flips the disabled prop synchronously on click and stays
    // set until the Realtime UPDATE on game_rounds.title_claimed_by lands
    // (after which the semantic gate takes over) -- no enable/disable
    // flicker in the gap.
    setPendingTitle(attemptId);
    markScoreStart(gameCode, roundId, "title");
    try {
      await applyAttempt(roundId, attemptId, TITLE_POINTS, {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "title");
      setPendingTitle((pending) => (pending === attemptId ? null : pending));
      reportError(err);
    } finally {
      if (titleInFlightRef.current === attemptId) titleInFlightRef.current = null;
    }
  }

  async function handleCorrectArtist() {
    if (artistInFlightRef.current === attemptId) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id || attemptId === null) return;
    artistInFlightRef.current = attemptId;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+${ARTIST_POINTS} to ${teamName} pending`, { variant: "info" });
    setPendingArtist(attemptId);
    markScoreStart(gameCode, roundId, "artist");
    try {
      await applyAttempt(roundId, attemptId, ARTIST_POINTS, {
        title_correct: false,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "artist");
      setPendingArtist((pending) => (pending === attemptId ? null : pending));
      reportError(err);
    } finally {
      if (artistInFlightRef.current === attemptId) artistInFlightRef.current = null;
    }
  }

  // Soundtrack rounds (current song has is_soundtrack=true) use a single
  // "Correct +15" button instead of the title/artist split. The team's job is
  // to name the work (film / TV / game / musical), not the song title; awarding
  // both flags at once sums to 15 points via the existing award_attempt
  // function -- no SQL change needed. Both tokens claim together; nothing more
  // can be scored on this round, so we let it sit in the fully-scored state
  // (lock held, player paused) and wait for the manager's "Next round" click,
  // mirroring how a regular round behaves once both title + artist are claimed.
  async function handleCorrectSoundtrack() {
    if (titleInFlightRef.current === attemptId || artistInFlightRef.current === attemptId) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id || attemptId === null) return;
    titleInFlightRef.current = attemptId;
    artistInFlightRef.current = attemptId;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+${SOUNDTRACK_POINTS} to ${teamName} pending`, { variant: "info" });
    setPendingTitle(attemptId);
    setPendingArtist(attemptId);
    markScoreStart(gameCode, roundId, "soundtrack");
    try {
      await applyAttempt(roundId, attemptId, SOUNDTRACK_POINTS, {
        title_correct: true,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "soundtrack");
      setPendingTitle((pending) => (pending === attemptId ? null : pending));
      setPendingArtist((pending) => (pending === attemptId ? null : pending));
      reportError(err);
    } finally {
      if (titleInFlightRef.current === attemptId) titleInFlightRef.current = null;
      if (artistInFlightRef.current === attemptId) artistInFlightRef.current = null;
    }
  }

  function resumeAfterRelease(roundId: string, releasedAttempt: number) {
    const game = latestGame.current;
    if (
      game?.game_code === gameCode &&
      game.status === "playing" &&
      !nextRoundInFlightRef.current &&
      game.round_number >= lastCommittedRoundRef.current &&
      game.current_round_id === roundId &&
      (game.buzzed_team_id === null || game.buzz_attempt_id === releasedAttempt)
    ) {
      livePlayer()?.play();
    }
  }

  async function handleContinueRound() {
    if (!managerToken || attemptId === null || continueInFlightRef.current === attemptId) return;
    if (!currentRoundId) return;
    continueInFlightRef.current = attemptId;
    toast("Continuing round…", { variant: "info" });
    setPendingContinue(attemptId);
    try {
      await releaseBuzzLockDirect(gameCode, managerToken, attemptId);
      resumeAfterRelease(currentRoundId, attemptId);
    } catch (err) {
      setPendingContinue((pending) => (pending === attemptId ? null : pending));
      reportError(err);
    } finally {
      if (continueInFlightRef.current === attemptId) continueInFlightRef.current = null;
    }
  }

  // Wrong is a one-click verdict: it fires award_attempt with wrong_buzz=true,
  // re-arms the buzzers, and resumes the song (no separate "Continue round"
  // press needed). Per game-rules.md §4 the -3 is waived only when the round's
  // one-shot free-guess flag is armed (`free_guess_active`), which the SQL
  // arms after a correct attempt and consumes on the very next attempt. We
  // mirror that exact flag here so the optimistic toast matches the score the
  // server will commit -- reading "any token claimed" instead would wrongly
  // suppress the -3 toast for every later wrong in a round that had a correct.
  // Playback resume is held until the RPC commits so a failed Wrong leaves the
  // song paused with the lock still held -- the manager can simply retry.
  async function handleWrong() {
    if (wrongInFlightRef.current === attemptId) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id || attemptId === null) return;
    wrongInFlightRef.current = attemptId;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    const freeGuess = state.currentRound.free_guess_active;
    if (teamName && !freeGuess)
      toast(`-${WRONG_BUZZ_PENALTY} to ${teamName} pending`, { variant: "info" });
    setPendingWrong(attemptId);
    try {
      await applyAttempt(roundId, attemptId, freeGuess ? 0 : -WRONG_BUZZ_PENALTY, {
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
      });
      resumeAfterRelease(roundId, attemptId);
    } catch (err) {
      setPendingWrong((pending) => (pending === attemptId ? null : pending));
      reportError(err);
    } finally {
      if (wrongInFlightRef.current === attemptId) wrongInFlightRef.current = null;
    }
  }

  async function handleNextRound() {
    if (nextRoundInFlightRef.current) return;
    if (!managerToken || !state) return;
    nextRoundInFlightRef.current = true;
    setAdvancingRound(true);
    // Bump the peek epoch so an in-flight peek is discarded: it answers for
    // the round we are leaving.
    peekEpochRef.current += 1;
    // Hold the next peek until select_next_song has recorded this round, so the
    // picker compares against the song that is about to play (mig 049).
    beginRoundCommit();
    let roundCommitted = false;
    // Snapshot and clear the peek. Only use a candidate based on the round
    // the manager can see or has confirmed through their last RPC.
    const expectedRound = Math.max(state.game.round_number, lastCommittedRoundRef.current);
    const peeked = peekedRef.current?.expected_round === expectedRound ? peekedRef.current : null;
    peekedRef.current = null;
    const songStart = beginSongStart(peeked ? "peek" : "fallback");
    toast("Loading next round...", { variant: "info" });
    // Snapshot for the rollback in the catch below: the song card that was up
    // before the in-tap start.
    const prevSong = currentSong;

    // IN-TAP PATH — load the peeked song on the visible player *synchronously
    // inside this tap*, BEFORE awaiting the RPC. Mobile browsers only allow
    // unmuted playback that begins within a user gesture; a load issued after
    // `await select_next_song` counts as blocked autoplay, which is exactly the
    // case where the player offers Play song. We pass peeked.song_id to the RPC below,
    // so a successful commit records the video we begin loading here. The
    // expected round tells the server when another host has already advanced
    // the game. Nothing is buffered ahead: YouTube's rules allow no hidden
    // player that plays (see useHostPlayer.ts), so this is a fresh load.
    if (peeked) {
      loadSongIntoPlayer(peeked);
      // I-NextMeta: the new song is already starting, so render its card
      // in-gesture from the peeked metadata (mig 038) instead of leaving the
      // PREVIOUS title up until select_next_song resolves ~150ms later. Record
      // the id first so the song-resolver effect treats this as an optimistic
      // lead (not staleness) and doesn't reload the old song. The RPC's
      // authoritative row reconciles the card below (same values).
      optimisticSongIdRef.current = peeked.song_id;
      setCurrentSong({
        id: peeked.song_id,
        title: peeked.title,
        artist: peeked.artist,
        youtube_id: peeked.youtube_id,
        start_time: peeked.start_time,
        is_soundtrack: peeked.is_soundtrack,
        release_year: peeked.release_year,
      });
    }

    try {
      const result = await selectNextSongDirect(
        gameCode,
        managerToken,
        expectedRound,
        peeked?.song_id,
      );
      roundCommitted = true;
      lastCommittedRoundRef.current = result.round_number;
      songStart.rpcDone({
        roundNumber: result.round_number,
        songId: result.song.id,
        youtubeId: result.song.youtube_id,
        preloaded: false,
      });
      const game = latestGame.current;
      if (game && game.round_number > result.round_number) {
        songStart.fail("superseded");
        clearSongStart();
        optimisticSongIdRef.current = null;
        livePlayer()?.stop();
        setCurrentSong(null);
        return;
      }
      // The RPC can finish before the Realtime event. Keep the round's song
      // from being replaced by the previous round while that update arrives.
      optimisticSongIdRef.current = result.song.id;
      setCurrentSong(result.song);
      if (peeked?.song_id !== result.song.id) {
        const startPaused =
          game?.round_number === result.round_number && game.buzzed_team_id != null;
        loadSongIntoPlayer(result.song, startPaused);
      }
    } catch (err) {
      const stale = err instanceof RpcError && err.message === "stale_round";
      const invalid = err instanceof RpcError && err.message === "song_no_longer_eligible";
      songStart.fail(
        stale ? "stale_round" : invalid ? "song_no_longer_eligible" : "select_next_song_failed",
      );
      clearSongStart();
      optimisticSongIdRef.current = null;
      if (peeked) {
        livePlayer()?.stop();
        if (!stale) {
          setCurrentSong(prevSong);
          if (prevSong) loadSongIntoPlayer(prevSong, latestGame.current?.buzzed_team_id != null);
          if (!invalid) peekedRef.current = peeked;
        }
      }
      reportError(err);
      if (stale) {
        await refreshGame();
        if (peeked) setCurrentSong(null); // Resolve and load the confirmed round, even on the same song.
      }
    } finally {
      nextRoundInFlightRef.current = false;
      setAdvancingRound(false);
      endRoundCommit(roundCommitted);
    }
  }

  // The expiry banner's "Keep playing +1h" -> extend_game direct RPC (mig
  // 039), pushing active_games.expires_at out an hour. The Realtime UPDATE on
  // expires_at is what moves the banner back to the subtle hint for everyone;
  // the toast just confirms the commit to the host who clicked.
  async function handleExtendGame() {
    if (extendInFlightRef.current) return;
    if (!state || !managerToken) return;
    extendInFlightRef.current = true;
    setPendingExtendFor(state.game.expires_at);
    try {
      const newExpiresAt = await extendGameDirect(gameCode, managerToken);
      const endsAt = new Date(newExpiresAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      toast(`Game extended — now ends at ${endsAt}`, { variant: "success" });
    } catch (err) {
      setPendingExtendFor(null);
      reportError(err);
    } finally {
      extendInFlightRef.current = false;
    }
  }

  async function handleBonus(teamId: string, teamName: string) {
    if (busy || bonusInFlight.current || !managerToken) return;
    bonusInFlight.current = true;
    const finish = beginScore(teamId, BONUS_POINTS);
    setBonusOpen(false);
    toast(`Sending +${BONUS_POINTS} to ${teamName}...`, { variant: "info" });
    setBusy(true);
    try {
      const total = await awardBonusDirect(gameCode, managerToken, teamId);
      finish(total);
      toast(`+${BONUS_POINTS} bonus to ${teamName}`, { variant: "success" });
    } catch (err) {
      finish(null);
      reportError(err);
    } finally {
      bonusInFlight.current = false;
      setBusy(false);
    }
  }

  async function performEnd() {
    if (busy || !managerToken) return;
    // Toast fires before the network call so the manager gets immediate
    // feedback the click registered; if endGame() fails reportError() will
    // surface the failure on top.
    toast("Ending game...", { variant: "info" });
    setBusy(true);
    try {
      await endGame(gameCode, managerToken);
      livePlayer()?.stop();
      clearManagerToken(gameCode);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  return {
    currentSong,
    advancingRound,
    scoreFeedback,
    busy,
    endConfirmOpen,
    setEndConfirmOpen,
    bonusOpen,
    setBonusOpen,
    pendingTitle,
    pendingArtist,
    pendingWrong,
    pendingContinue,
    pendingExtendFor,
    handleCorrectTitle,
    handleCorrectArtist,
    handleCorrectSoundtrack,
    handleContinueRound,
    handleWrong,
    handleNextRound,
    handleExtendGame,
    handleBonus,
    performEnd,
  };
}
