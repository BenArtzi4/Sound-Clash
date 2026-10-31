import { useEffect, useRef, useState } from "react";
import { useToast } from "../context/useToast";
import { ApiError, awardBonus, endGame } from "../lib/api";
import {
  awardAttemptDirect,
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
import type { GameState, Song } from "../lib/types";
import type { HostPlayer } from "./useHostPlayer";

// Extracted from ManagerConsolePage (T7.2). Owns the manager scoring + round
// actions: the direct-RPC calls (award_attempt / release_buzz_lock /
// select_next_song / extend_game) and the FastAPI-routed ones (bonus / end),
// the optimistic-toast-then-await ordering, the per-action in-flight guards, and
// the pending-flag handoffs that bridge the RPC → Realtime gap. handleNextRound
// drives the host's player through the HostPlayer surface passed in.

interface PlayerReadyHandle {
  ready: boolean;
  enqueueSong: (song: { youtube_id: string; start_time: number }) => void;
}

export interface Scoring {
  currentSong: Song | null;
  busy: boolean;
  endConfirmOpen: boolean;
  setEndConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  bonusOpen: boolean;
  setBonusOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pendingTitle: string | null;
  pendingArtist: string | null;
  pendingWrong: string | null;
  pendingContinue: string | null;
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
  player: PlayerReadyHandle,
  hostPlayer: HostPlayer,
): Scoring {
  const { toast } = useToast();
  const {
    livePlayer,
    peekedRef,
    peekEpochRef,
    optimisticSongIdRef,
    songStartRef,
    loadSongIntoPlayer,
    armSongStartTimeout,
    beginSongStart,
    beginRoundCommit,
    endRoundCommit,
  } = hostPlayer;

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [busy, setBusy] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);

  // Optimistic "we just clicked this" markers for the per-round action buttons,
  // each holding the round id the click happened on. They bridge the ~50-
  // 100ms gap between the RPC returning and the Realtime UPDATE on game_rounds
  // (title_claimed_by / artist_claimed_by) or active_games (buzzed_team_id)
  // arriving -- keeping the button disabled across that gap so it doesn't flash
  // enabled in the window. The flag is naturally self-clearing on round change
  // (stale id won't equal the new round.id) and gets reset by the effects
  // below for tidiness. Cleared in each handler's catch on failure so a
  // transient RPC error doesn't leave the button permanently disabled.
  // pendingContinue mirrors pendingWrong: Continue releases the buzz lock, so
  // it stays disabled until the Realtime UPDATE clears buzzed_team_id.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null);
  const [pendingArtist, setPendingArtist] = useState<string | null>(null);
  const [pendingWrong, setPendingWrong] = useState<string | null>(null);
  const [pendingContinue, setPendingContinue] = useState<string | null>(null);
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
  const titleInFlightRef = useRef(false);
  const artistInFlightRef = useRef(false);
  const wrongInFlightRef = useRef(false);
  const continueInFlightRef = useRef(false);
  const nextRoundInFlightRef = useRef(false);
  const extendInFlightRef = useRef(false);

  // When we get the buzz lock signal, pause playback on the live player.
  useEffect(() => {
    if (state?.game.buzzed_team_id != null) {
      livePlayer()?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.game.buzzed_team_id]);

  // Reset the per-click pending flags whenever the round changes. The
  // disabled checks already compare against `round?.id` so stale flags
  // are inert, but clearing them keeps state tidy and avoids confusion
  // when debugging.
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

  // Wrong and Continue both release the buzz lock, so a follow-up buzz in the
  // same round must re-enable their buttons. `pendingWrong` / `pendingContinue`
  // only bridge the gap between the RPC returning and the Realtime UPDATE on
  // buzzed_team_id; once that UPDATE has landed (lock cleared) the flags have
  // done their job and must drop or the next buzz's click stays blocked.
  useEffect(() => {
    if (state?.game.buzzed_team_id == null) {
      setPendingWrong(null);
      setPendingContinue(null);
    }
  }, [state?.game.buzzed_team_id]);

  // After a manager-tab refresh mid-round, currentSong is null but the round
  // row still has a song_id. Resolve it and push it into the player so the
  // host doesn't have to abandon the round and click Next round. Must stay
  // loadVideoById (not cueVideoById): on the happy path the Realtime INSERT
  // for the new round arrives before selectSong's HTTP response, so this
  // effect races with handleNextRound's loadVideoById. Calling cue while load
  // is in flight (or vice-versa) puts YT.Player into an inconsistent state and
  // surfaces as the "Video unavailable" onError overlay.
  const currentRoundSongId = state?.currentRound?.song_id ?? null;
  const playerReady = player.ready;
  useEffect(() => {
    if (!currentRoundSongId) return;
    if (currentSong && currentSong.id === currentRoundSongId) return;
    // I-NextMeta: currentSong is the optimistically-committed next song, ahead of
    // the round that hasn't advanced yet — NOT a stale leftover. Don't refetch
    // the old round's song (which would also reload it over the promoted player);
    // the round will catch up momentarily and the RPC reconciles the metadata.
    if (currentSong && currentSong.id === optimisticSongIdRef.current) return;
    let cancelled = false;
    // fetchSongById retries transient failures with bounded backoff (F-P1-7)
    // so one blip doesn't leave the post-refresh player empty for the round.
    void fetchSongById(currentRoundSongId, () => cancelled).then((song) => {
      if (cancelled || !song) return;
      setCurrentSong(song);
      if (playerReady) {
        livePlayer()?.loadVideoById(song.youtube_id, song.start_time);
      } else {
        player.enqueueSong({ youtube_id: song.youtube_id, start_time: song.start_time });
      }
    });
    return () => {
      cancelled = true;
    };
    // `player` is a stable hook handle; we only need to re-run when the
    // current round's song changes or the player flips to ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoundSongId, currentSong?.id, playerReady]);

  function reportError(err: unknown) {
    if (err instanceof ApiError) {
      const reason =
        err.details && typeof err.details === "object" && err.details !== null
          ? (err.details as { reason?: unknown }).reason
          : undefined;
      if (err.status === 409 && reason === "no_more_songs") {
        toast(
          "All songs in your selected genres have been played. End the game or start a new one with more genres.",
          { variant: "error" },
        );
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
        toast(
          "All songs in your selected genres have been played. End the game or start a new one with more genres.",
          { variant: "error" },
        );
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

  // Apply an attempt via the direct browser -> Supabase RPC. Migration 021
  // moved the manager-token gate into the PL/pgSQL function, so we bypass
  // FastAPI/Render here and cut ~300ms of cross-continent hops off the
  // critical path. The score commit and the Realtime fan-out happen in the
  // same DB transaction; the UI then redraws when game_teams / game_rounds
  // UPDATE events arrive.
  async function applyAttempt(
    roundId: string,
    flags: { title_correct: boolean; artist_correct: boolean; wrong_buzz: boolean },
  ): Promise<void> {
    if (!managerToken) return;
    await awardAttemptDirect(gameCode, managerToken, roundId, flags);
  }

  // Helper for the optimistic toast on the three scoring buttons. Fired
  // before the RPC so the click feels instant; the Realtime UPDATE on
  // game_teams.score is still the source of truth for the displayed score.
  function buzzedTeamName(): string | null {
    if (!state) return null;
    const tid = state.game.buzzed_team_id;
    if (!tid) return null;
    return state.teams.get(tid)?.name ?? null;
  }

  async function handleCorrectTitle() {
    if (titleInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    titleInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+${TITLE_POINTS} to ${teamName}`, { variant: "success" });
    // Pending flag flips the disabled prop synchronously on click and stays
    // set until the Realtime UPDATE on game_rounds.title_claimed_by lands
    // (after which the semantic gate takes over) -- no enable/disable
    // flicker in the gap.
    setPendingTitle(roundId);
    markScoreStart(gameCode, roundId, "title");
    try {
      await applyAttempt(roundId, {
        title_correct: true,
        artist_correct: false,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "title");
      setPendingTitle(null);
      reportError(err);
    } finally {
      titleInFlightRef.current = false;
    }
  }

  async function handleCorrectArtist() {
    if (artistInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    artistInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+${ARTIST_POINTS} to ${teamName}`, { variant: "success" });
    setPendingArtist(roundId);
    markScoreStart(gameCode, roundId, "artist");
    try {
      await applyAttempt(roundId, {
        title_correct: false,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "artist");
      setPendingArtist(null);
      reportError(err);
    } finally {
      artistInFlightRef.current = false;
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
    if (titleInFlightRef.current || artistInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    titleInFlightRef.current = true;
    artistInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    if (teamName) toast(`+${SOUNDTRACK_POINTS} to ${teamName}`, { variant: "success" });
    setPendingTitle(roundId);
    setPendingArtist(roundId);
    markScoreStart(gameCode, roundId, "soundtrack");
    try {
      await applyAttempt(roundId, {
        title_correct: true,
        artist_correct: true,
        wrong_buzz: false,
      });
    } catch (err) {
      failScore(roundId, "soundtrack");
      setPendingTitle(null);
      setPendingArtist(null);
      reportError(err);
    } finally {
      titleInFlightRef.current = false;
      artistInFlightRef.current = false;
    }
  }

  async function handleContinueRound() {
    if (continueInFlightRef.current) return;
    if (!managerToken) return;
    continueInFlightRef.current = true;
    // Optimistic toast fires before the RPC so the click feels instant; the
    // Realtime UPDATE on active_games.buzzed_team_id is still the source of
    // truth for re-arming the buzzers.
    toast("Round continued", { variant: "info" });
    // Keep Continue disabled until the lock actually clears via Realtime, the
    // same handoff pendingWrong uses -- no enable/disable flash in the gap.
    setPendingContinue(state?.currentRound?.id ?? null);
    try {
      await releaseBuzzLockDirect(gameCode, managerToken);
      livePlayer()?.play();
    } catch (err) {
      setPendingContinue(null);
      reportError(err);
    } finally {
      continueInFlightRef.current = false;
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
    if (wrongInFlightRef.current) return;
    if (!state?.currentRound || !managerToken) return;
    if (!state.game.buzzed_team_id) return;
    wrongInFlightRef.current = true;
    const roundId = state.currentRound.id;
    const teamName = buzzedTeamName();
    const freeGuess = state.currentRound.free_guess_active;
    if (teamName && !freeGuess) toast(`-${WRONG_BUZZ_PENALTY} to ${teamName}`, { variant: "info" });
    setPendingWrong(roundId);
    try {
      await applyAttempt(roundId, {
        title_correct: false,
        artist_correct: false,
        wrong_buzz: true,
      });
      livePlayer()?.play();
    } catch (err) {
      setPendingWrong(null);
      reportError(err);
    } finally {
      wrongInFlightRef.current = false;
    }
  }

  async function handleNextRound() {
    if (nextRoundInFlightRef.current) return;
    if (!managerToken) return;
    nextRoundInFlightRef.current = true;
    // Bump the peek epoch so an in-flight peek is discarded: it answers for
    // the round we are leaving.
    peekEpochRef.current += 1;
    // Hold the next peek until select_next_song has recorded this round, so the
    // picker compares against the song that is about to play (mig 049).
    beginRoundCommit();
    let roundCommitted = false;
    // Open the song-start span at the click instant (before the toast) so it
    // captures click → RPC → load → audio actually playing.
    const songStart = beginSongStart();
    // Optimistic toast confirms the click immediately.
    toast("Loading next round...", { variant: "info" });
    // Snapshot + clear the peeked song now so a late peek can't reuse it.
    const peeked = peekedRef.current;
    peekedRef.current = null;
    // Snapshot for the rollback in the catch below: the song card that was up
    // before the in-tap start.
    const prevSong = currentSong;

    // IN-TAP PATH — load the peeked song on the visible player *synchronously
    // inside this tap*, BEFORE awaiting the RPC. Mobile browsers only allow
    // unmuted playback that begins within a user gesture; a load issued after
    // `await select_next_song` counts as blocked autoplay, which is exactly the
    // reported bug (round 1 / Next round stayed silent until a stray buzz +
    // Continue finally unlocked it). We pass peeked.song_id to the RPC below,
    // so the video we begin loading here is guaranteed to be the one the round
    // records — it's safe to start it before the round is committed
    // server-side. Nothing is buffered ahead: YouTube's rules allow no hidden
    // player that plays (see useHostPlayer.ts), so this is a fresh load.
    if (peeked) {
      songStart.loadIssued();
      armSongStartTimeout();
      livePlayer()?.loadVideoById(peeked.youtube_id, peeked.start_time);
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
      if (peeked) {
        // Confirm/record the round for the exact song we already started.
        const result = await selectNextSongDirect(gameCode, managerToken, peeked.song_id);
        roundCommitted = true;
        songStart.rpcDone({
          roundNumber: result.round_number,
          songId: result.song.id,
          youtubeId: result.song.youtube_id,
          // Nothing is prebuffered any more (2026-10-31): every song is a
          // fresh load. Kept so old and new spans stay comparable.
          preloaded: false,
        });
        setCurrentSong(result.song);
        if (result.song.id !== peeked.song_id) {
          // Defensive: the RPC picked something other than what we peeked and
          // already began loading (should not happen with an explicit
          // song_id). Load the real song instead.
          await loadSongIntoPlayer(result.song);
        }
      } else {
        // Slow path (the peek missed, failed, or the pool was empty at peek
        // time): random pick, then the load. On mobile this load lands after
        // the await, so it can't reliably autoplay — but the waiting-screen
        // peek normally routes round 1 through the in-tap path above, leaving
        // this as a rare fallback.
        const result = await selectNextSongDirect(gameCode, managerToken);
        roundCommitted = true;
        songStart.rpcDone({
          roundNumber: result.round_number,
          songId: result.song.id,
          youtubeId: result.song.youtube_id,
          preloaded: false,
        });
        // The RPC answers before the new round's Realtime event (measured
        // ~275 ms), so for a moment the card leads the round, just as on the
        // in-tap path. Mark the lead or the song resolver reloads the previous
        // round's song over this one.
        optimisticSongIdRef.current = result.song.id;
        setCurrentSong(result.song);
        await loadSongIntoPlayer(result.song);
      }
    } catch (err) {
      songStart.fail("select_next_song_failed");
      songStartRef.current = null;
      optimisticSongIdRef.current = null;
      // The round failed to advance server-side, so the in-tap start (which
      // has to happen before the await for mobile autoplay) must not stand.
      // Roll it back: silence the new song, restore the pre-click song card,
      // and reload the still-current round's song so the room isn't left in
      // silence (best-effort on strict mobile autoplay — this load lands
      // outside the gesture). The peeked song is kept: the round never
      // advanced, so it is still exactly what select_next_song would record,
      // and a retry click keeps the in-tap path.
      if (peeked) {
        livePlayer()?.stop();
        setCurrentSong(prevSong);
        if (prevSong) livePlayer()?.loadVideoById(prevSong.youtube_id, prevSong.start_time);
        peekedRef.current = peeked;
      }
      reportError(err);
    } finally {
      nextRoundInFlightRef.current = false;
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
    if (busy || !managerToken) return;
    // Close the picker and acknowledge the click immediately, but do NOT
    // claim success yet: the bonus is the one Render-routed scoring call, so
    // on a cold start it can hang for many seconds or fail outright, and an
    // optimistic "+4" here let the host believe a bonus landed that the room
    // never saw (F-P1-5). The success toast waits for the call to resolve;
    // `busy` keeps Bonus + End game gated while it's in flight (the per-round
    // scoring buttons stay deliberately independent of it).
    setBonusOpen(false);
    toast(`Sending +${BONUS_POINTS} to ${teamName}...`, { variant: "info" });
    setBusy(true);
    try {
      await awardBonus(gameCode, managerToken, { team_id: teamId });
      toast(`+${BONUS_POINTS} bonus to ${teamName}`, { variant: "success" });
    } catch (err) {
      reportError(err);
    } finally {
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
