import { useEffect, useReducer, useRef, useState } from "react";
import { supabase, type RealtimeChannel } from "../lib/supabase";
import type {
  ActiveGame,
  BuzzLock,
  GameAction,
  GameRound,
  GameState,
  PostgresChangePayload,
  Team,
} from "../lib/types";
import { observeServerTime, serverTimeNow } from "./useServerTime";
import { log, recordFanout, resolveBuzzE2E, resolveScoreE2E } from "../lib/telemetry";

export type ChannelStatus = "idle" | "connecting" | "subscribed" | "reconnecting" | "gone";

// The 4h expiry sweep (cleanup_expired_games) only touches games whose
// expires_at has passed, so the clock discriminates its teardown from other
// row changes (server-offset clock; falls back to the device clock until the
// first Realtime event is observed). Shared by the team page's kick-vs-expiry
// logic and the final-board snapshot below.
export function isGameExpired(game: ActiveGame): boolean {
  const expiresAt = Date.parse(game.expires_at);
  return Number.isFinite(expiresAt) && serverTimeNow().getTime() >= expiresAt;
}

// Backstop re-fetch interval. Supabase Realtime over WebSocket occasionally
// drops a postgres_changes event (flaky networks, a missed heartbeat that
// silently re-joins, the free tier under load) — and a missed "a team buzzed"
// event would strand the manager with greyed-out scoring buttons until the
// next state change. So on a cadence we re-hydrate from the tables; the
// reducer's HYDRATE skips the dispatch when nothing material changed, so a
// quiet round costs ~3 REST queries per tick with zero re-renders.
//
// Migrations 009/010 fixed the original Realtime-event-loss bugs, so the resync
// is a true safety net, not the primary sync path. It was 20s; at 60s it does
// ~3× fewer backstop queries per visible client (a 6-team game drops from
// ~1.2 to ~0.4 q/s) while still catching a genuinely dropped event within a
// minute — comfortably faster than a human notices a stuck button. Exported so
// the test can advance fake timers by exactly one interval.
export const RESYNC_INTERVAL_MS = 60_000;

// While Realtime is disconnected or the local state holds a buzz lock the
// backstop tightens to this cadence (#254). A stale lock is the one desync that silently kills gameplay:
// the buzz button is dead and buzz_in's own guard refuses to fire, so nothing
// the player does can self-correct it (a stale UNLOCKED view heals on the next
// press — buzz_in returns the true winner). Two lock-clearing writes carry no
// redundant Realtime signal at all (release_buzz_lock, award_attempt's wrong
// branch), and realtime-js can sit on a half-open socket for ~25-50s before
// its heartbeat notices (status stays "subscribed", events silently lost) —
// so time is the only recovery for them. Locked windows are a fraction of a
// game and HYDRATE no-ops when nothing changed, so the extra cost is ~3 REST
// queries per 15s per visible client in either case. Must divide
// RESYNC_INTERVAL_MS evenly (the quiet cadence is every Nth tick).
export const LOCKED_RESYNC_INTERVAL_MS = 15_000;

// How long a backstop repair waits for the Realtime frame before it counts as
// a dropped event (#361). The poll often reads a lock-clear that committed a
// moment earlier and gets its response back before the clear's Realtime frame
// (fan-out is ~150-900 ms). That frame was only in flight, not lost. Logging
// before it could arrive turned ordinary fan-out lag into a false
// `stale_buzz_lock_resynced`. Every one of nine sampled warnings, from real
// iPhones and from the prod harness, was this race. Only the diagnostic waits;
// the repair is applied at once.
export const STALE_LOCK_CONFIRM_MS = 3_000;

// Recent lock observations kept for that verdict. A lock is held across only a
// handful of active_games events and 15 s backstop ticks, so this comfortably
// covers the stretch since the client learned the lock it is holding.
const LOCK_LOG_SIZE = 32;

// Ceiling on the pre-hydration event queue. The queue only grows while the
// event gate is closed (no authoritative snapshot has succeeded yet), so
// reaching the cap means hydrate has been failing for a long stretch while
// events flood in. On overflow the backlog is dropped AND a fresh
// authoritative hydrate is requested — its full snapshot supersedes every
// dropped event, so unlike a plain discard nothing is lost. Exported for the
// overflow test.
export const MAX_PENDING_EVENTS = 500;

// Explicit column list for the active_games hydrate — every field the reducer
// reads, and nothing else. Deliberately NOT `select("*")`: the per-game
// manager_token used to live on this row, and any anon client (every player)
// hydrating with `*` would read the host's credential. Migration 034 moved the
// token into a separate anon-invisible table (game_secrets), so `*` is safe
// now too, but naming the columns keeps the host credential off this
// anon-readable, Realtime-published row for good. Mirrors the ActiveGame type.
const ACTIVE_GAME_COLUMNS =
  "game_code,status,selected_genres,selected_decades,round_number," +
  "current_song_id,current_round_id,buzzed_team_id,locked_at,started_at,ended_at,expires_at";

// Round INSERT can advance the UI even when its active_games UPDATE is lost.
function gameIsOlder(game: ActiveGame, current: ActiveGame): boolean {
  if (
    game.game_code !== current.game_code ||
    game.buzz_revision === undefined ||
    current.buzz_revision === undefined
  )
    return false;
  const age = Date.parse(game.started_at) - Date.parse(current.started_at);
  return (
    age < 0 ||
    (age === 0 &&
      (game.buzz_revision < current.buzz_revision ||
        game.round_number < current.round_number ||
        (game.buzz_revision === current.buzz_revision &&
          game.buzz_attempt_id === undefined &&
          current.buzz_attempt_id !== undefined)))
  );
}

function isBuzzLock(payload: unknown): payload is BuzzLock {
  if (!payload || typeof payload !== "object") return false;
  const lock = payload as Partial<BuzzLock>;
  return (
    typeof lock.game_code === "string" &&
    lock.status === "playing" &&
    Array.isArray(lock.selected_genres) &&
    Array.isArray(lock.selected_decades) &&
    Number.isSafeInteger(lock.round_number) &&
    typeof lock.started_at === "string" &&
    Number.isFinite(Date.parse(lock.started_at)) &&
    typeof lock.expires_at === "string" &&
    typeof lock.current_round_id === "string" &&
    typeof lock.buzzed_team_id === "string" &&
    typeof lock.locked_at === "string" &&
    Number.isFinite(Date.parse(lock.locked_at)) &&
    typeof lock.buzz_revision === "number" &&
    Number.isSafeInteger(lock.buzz_revision) &&
    (lock.buzz_attempt_id === undefined ||
      (typeof lock.buzz_attempt_id === "number" && Number.isSafeInteger(lock.buzz_attempt_id)))
  );
}

function activeGameEqual(a: ActiveGame, b: ActiveGame): boolean {
  if (
    a.game_code !== b.game_code ||
    a.status !== b.status ||
    a.round_number !== b.round_number ||
    a.current_song_id !== b.current_song_id ||
    a.current_round_id !== b.current_round_id ||
    a.buzzed_team_id !== b.buzzed_team_id ||
    a.locked_at !== b.locked_at ||
    a.buzz_attempt_id !== b.buzz_attempt_id ||
    a.buzz_revision !== b.buzz_revision ||
    a.started_at !== b.started_at ||
    a.ended_at !== b.ended_at ||
    a.expires_at !== b.expires_at
  ) {
    return false;
  }
  if (a.selected_decades.length !== b.selected_decades.length) return false;
  if (a.selected_decades.some((decade, index) => decade !== b.selected_decades[index]))
    return false;
  if (a.selected_genres.length !== b.selected_genres.length) return false;
  for (let i = 0; i < a.selected_genres.length; i++) {
    if (a.selected_genres[i] !== b.selected_genres[i]) return false;
  }
  return true;
}

function teamEqual(a: Team, b: Team): boolean {
  return a.id === b.id && a.name === b.name && a.score === b.score && a.joined_at === b.joined_at;
}

function roundEqual(a: GameRound, b: GameRound): boolean {
  return (
    a.id === b.id &&
    a.round_number === b.round_number &&
    a.song_id === b.song_id &&
    a.started_at === b.started_at &&
    a.buzzed_team_id === b.buzzed_team_id &&
    a.title_points === b.title_points &&
    a.artist_points === b.artist_points &&
    a.wrong_buzz_penalty === b.wrong_buzz_penalty &&
    a.title_claimed_by === b.title_claimed_by &&
    a.artist_claimed_by === b.artist_claimed_by &&
    a.free_guess_active === b.free_guess_active &&
    a.ended_at === b.ended_at
  );
}

type SnapshotChange<Row> = { requestId: number; row: Row | null };

function rememberRowChange<Row extends { id: string }>(
  changes: Map<string, SnapshotChange<Row>>,
  payload: PostgresChangePayload<Row>,
  requestId: number,
): void {
  if (payload.eventType === "DELETE") {
    if (payload.old.id) changes.set(payload.old.id, { requestId, row: null });
  } else if (payload.new.id) {
    changes.set(payload.new.id, { requestId, row: payload.new as Row });
  }
}

function mergeSnapshotRows<Row extends { id: string }>(
  rows: Row[],
  changes: Map<string, SnapshotChange<Row>>,
  requestId: number,
): Row[] {
  if (changes.size === 0) return rows;
  const merged = new Map(rows.map((row) => [row.id, row]));
  for (const [id, change] of changes) {
    if (change.requestId < requestId) continue;
    if (change.row) merged.set(id, change.row);
    else merged.delete(id);
  }
  return [...merged.values()];
}

function deriveRoundAdvance(game: ActiveGame, round: GameRound): ActiveGame {
  if (round.round_number <= game.round_number) return game;
  return {
    ...game,
    status: "playing",
    round_number: round.round_number,
    current_song_id: round.song_id,
    current_round_id: round.id,
    buzzed_team_id: null,
    buzz_attempt_id: game.buzz_attempt_id === undefined ? undefined : null,
    locked_at: null,
  };
}

// Compare a freshly-hydrated payload against the current reducer state. If
// every field the UI consumes matches, returning the same state reference from
// the reducer lets React skip the whole render cascade. The periodic resync
// hits this path for every quiet 20s interval — BuzzButton, the
// YouTubePlayer wrapper, etc. all stop re-rendering on backstop ticks.
function hydrateUnchanged(
  state: GameState,
  game: ActiveGame,
  teams: Team[],
  rounds: GameRound[],
): boolean {
  if (!activeGameEqual(state.game, game)) return false;
  if (state.teams.size !== teams.length) return false;
  for (const t of teams) {
    const existing = state.teams.get(t.id);
    if (!existing || !teamEqual(existing, t)) return false;
  }
  if (state.rounds.length !== rounds.length) return false;
  // state.rounds is already sorted by round_number; the fresh `rounds` array
  // comes straight from PostgREST. Sort the fresh copy once before comparing.
  const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number);
  for (let i = 0; i < sorted.length; i++) {
    const existing = state.rounds[i];
    const fresh = sorted[i];
    if (!existing || !fresh) return false;
    if (!roundEqual(existing, fresh)) return false;
  }
  return true;
}

export function gameReducer(state: GameState | null, action: GameAction): GameState | null {
  switch (action.type) {
    case "HYDRATE": {
      const game = state && gameIsOlder(action.game, state.game) ? state.game : action.game;
      if (state !== null && hydrateUnchanged(state, game, action.teams, action.rounds)) {
        return state;
      }
      const teams = new Map(action.teams.map((t) => [t.id, t]));
      const rounds = [...action.rounds].sort((a, b) => a.round_number - b.round_number);
      const currentRound = rounds.find((r) => r.id === game.current_round_id) ?? null;
      return { game, teams, rounds, currentRound };
    }
    case "BUZZ_LOCK": {
      const { lock } = action;
      if (
        !state ||
        state.game.status === "ended" ||
        lock.game_code !== state.game.game_code ||
        Date.parse(lock.started_at) !== Date.parse(state.game.started_at) ||
        state.game.buzz_revision === undefined ||
        lock.buzz_revision <= state.game.buzz_revision ||
        gameIsOlder(lock, state.game)
      )
        return state;
      const currentRound = state.rounds.find((round) => round.id === lock.current_round_id) ?? null;
      return { ...state, game: lock, currentRound };
    }
    case "GAME_CHANGE": {
      if (state === null) return null;
      const { eventType, new: row } = action.payload;
      if (eventType === "DELETE") return null;
      const game = row as ActiveGame;
      if (gameIsOlder(game, state.game) || activeGameEqual(state.game, game)) return state;
      const currentRound = state.rounds.find((r) => r.id === game.current_round_id) ?? null;
      return { ...state, game, currentRound };
    }
    case "TEAM_CHANGE": {
      if (state === null) return null;
      const { eventType } = action.payload;
      if (eventType === "DELETE") {
        const oldRow = action.payload.old as Partial<Team>;
        if (!oldRow.id) return state;
        const teams = new Map(state.teams);
        teams.delete(oldRow.id);
        return { ...state, teams };
      }
      const team = action.payload.new as Team;
      const teams = new Map(state.teams);
      teams.set(team.id, team);
      return { ...state, teams };
    }
    case "ROUND_CHANGE": {
      if (state === null) return null;
      const { eventType } = action.payload;
      if (eventType === "DELETE") {
        const oldRow = action.payload.old as Partial<GameRound>;
        if (!oldRow.id) return state;
        const rounds = state.rounds.filter((r) => r.id !== oldRow.id);
        const currentRound = state.currentRound?.id === oldRow.id ? null : state.currentRound;
        return { ...state, rounds, currentRound };
      }
      const round = action.payload.new as GameRound;
      if (eventType === "INSERT") {
        const exists = state.rounds.some((r) => r.id === round.id);
        const merged = exists
          ? state.rounds.map((r) => (r.id === round.id ? round : r))
          : [...state.rounds, round].sort((a, b) => a.round_number - b.round_number);
        // Round-advance derivation (#254): start_round (the only writer that
        // inserts game_rounds rows) inserts the new round AND updates
        // active_games in ONE transaction, setting exactly status='playing',
        // round_number, current_song_id, current_round_id, buzzed_team_id=NULL,
        // locked_at=NULL (docs/rpc-functions.md §start_round). An inserted
        // round AHEAD of our game row therefore proves the game row has moved
        // — derive that transition here instead of depending on the
        // active_games UPDATE event arriving. Realtime never replays a lost
        // event, and a client that missed that UPDATE used to keep the
        // PREVIOUS round's buzz lock ("SOMEONE ELSE BUZZED" in a fresh round)
        // until the 60s backstop. Strictly `>`: a re-delivered INSERT of the
        // in-progress round must never re-null a live buzz lock, and when the
        // UPDATE arrived first the game row is already ahead, so this no-ops.
        const game = deriveRoundAdvance(state.game, round);
        const currentRound = game.current_round_id === round.id ? round : state.currentRound;
        return { ...state, game, rounds: merged, currentRound };
      }
      // UPDATE
      const rounds = state.rounds.map((r) => (r.id === round.id ? round : r));
      const currentRound = state.currentRound?.id === round.id ? round : state.currentRound;
      return { ...state, rounds, currentRound };
    }
    case "GAME_DELETED":
      return null;
  }
}

export function useGameChannel(gameCode: string): {
  state: GameState | null;
  status: ChannelStatus;
  error: Error | null;
  finalBoard: GameState | null;
  refresh: () => Promise<void>;
} {
  const [state, dispatch] = useReducer(gameReducer, null);
  const [status, setStatus] = useState<ChannelStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  // Latest committed game, mirrored into a ref so the mount effect's closures
  // (the backstop interval and hydrate) can read it — they close over the
  // first render's `state` otherwise. Drives the lock-aware backstop cadence
  // and the stale-lock diagnostic below (#254).
  const gameRef = useRef<ActiveGame | null>(null);
  useEffect(() => {
    gameRef.current = state?.game ?? null;
  }, [state]);

  // A lock can reach the room before its team or round change. Fetch the
  // missing rows once for that lock so the host can score it right away.
  const lockTeamId = state?.game.buzzed_team_id;
  const lockRoundId = state?.game.current_round_id;
  const lockNeedsSnapshot =
    state?.game.game_code === gameCode &&
    state.game.buzz_revision !== undefined &&
    lockTeamId != null &&
    (!state.teams.has(lockTeamId) || (lockRoundId != null && state.currentRound === null));
  useEffect(() => {
    if (lockNeedsSnapshot) void refreshRef.current?.();
  }, [gameCode, lockNeedsSnapshot, lockTeamId, lockRoundId]);

  // Last-known state worth rendering as a final scoreboard once the game rows
  // are gone (I-FinalBoard). During live play every committed state refreshes
  // it. The expiry sweep cascade-deletes game_teams/game_rounds along with
  // active_games; those child DELETEs can arrive before the game-row DELETE
  // that nulls `state`, so the states committed mid-teardown shrink team by
  // team — a snapshot taken then would wipe teams off the final board. So a
  // shrinking update is skipped when it's part of a teardown:
  //   • the game is `ended` — every shrink now is the post-end sweep, so hold
  //     the whole board (the common, important case: the host ends the game and
  //     the final board must persist); OR
  //   • the game is expired-but-unended (an abandoned game the hourly sweep is
  //     tearing down) AND the shrink is NOT a lone kick.
  // A KICK — one team removed, ≥1 team left in the room, round history intact —
  // is always honored, even in the overdue-but-unswept window (past expires_at
  // but still `playing`, kept alive by the "Keep playing +1h" banner). Deleting
  // a team's row there is a real host action; the removed team must NOT linger
  // on the final board. Using the clock alone to mean "teardown" wrongly froze
  // the snapshot over such a kick. Removing the last team, or a shrink that also
  // drops rounds, is the sweep's cascade → held.
  // Residual (accepted, abandoned games only): a >4h-overrun game the host never
  // ended, whose sweep happens to deliver its team DELETEs before its round
  // DELETEs, can show a partial final board — each intermediate team removal is
  // indistinguishable from a kick without lookahead. The ended-game path and
  // rounds-first / last-team sweeps are fully protected. Known gap unchanged: if
  // the sweep's DELETEs drain in the same React batch as the first successful
  // hydrate, no live state commits and the pages fall back to the plain banner.
  //
  // Held in state (not a ref) so consumers see it reactively; the functional
  // updater returns the SAME reference on a held teardown-shrink, so React skips
  // the otherwise-extra render in exactly that case, and on quiet backstop ticks
  // the effect doesn't run at all (the reducer returns the same `state` ref).
  const [finalBoardState, setFinalBoardState] = useState<GameState | null>(null);
  useEffect(() => {
    if (!state) return;
    setFinalBoardState((snap) => {
      if (snap === null || snap.game.game_code !== state.game.game_code) return state;
      const shrank = state.teams.size < snap.teams.size || state.rounds.length < snap.rounds.length;
      if (!shrank) return state;
      // One team gone, room still populated, rounds untouched: a host kick.
      const looksLikeKick =
        state.teams.size === snap.teams.size - 1 &&
        state.teams.size > 0 &&
        state.rounds.length === snap.rounds.length;
      const teardownShrink =
        state.game.status === "ended" || (isGameExpired(state.game) && !looksLikeKick);
      return teardownShrink ? snap : state;
    });
  }, [state]);
  // Guard against a stale snapshot when the same mounted hook is pointed at a
  // different game code (the reducer state has the same lag until the new
  // game's first HYDRATE lands; the snapshot must not outlive it either).
  const finalBoard = finalBoardState?.game.game_code === gameCode ? finalBoardState : null;

  useEffect(() => {
    if (!gameCode) return;
    let cancelled = false;
    let hydrated = false;
    let realtimeDisconnected = false;
    let hydrateRequestId = 0;
    let lastAppliedHydrateId = 0;
    let inFlightHydrates = 0;
    let checkingUnlock = false;
    const revisionColumns = `${ACTIVE_GAME_COLUMNS},buzz_revision`;
    const attemptColumns = `${revisionColumns},buzz_attempt_id`;
    let gameColumns = attemptColumns;
    let buzzChannel: RealtimeChannel | undefined;
    let gameChange: { requestId: number; row: ActiveGame } | undefined;
    let roundInsert: { requestId: number; row: GameRound } | undefined;
    const teamChanges = new Map<string, SnapshotChange<Team>>();
    const roundChanges = new Map<string, SnapshotChange<GameRound>>();
    // Set once the game is permanently gone (row deleted / missing). Stops the
    // backstop interval and tears the channel down so a display left open all
    // night on an ended game doesn't keep polling + holding a subscription
    // forever. Distinct from `cancelled` (which is unmount) — the component
    // stays mounted showing the "ended" screen, we just stop the live plumbing.
    let goneTornDown = false;
    // Realtime events that arrive between SUBSCRIBED and HYDRATE land on
    // state===null and are dropped by the reducer's null guards. Queue them
    // here and replay after HYDRATE; gameReducer is idempotent so replay is
    // safe. Capped at MAX_PENDING_EVENTS — see the constant's comment.
    const pending: GameAction[] = [];
    setStatus("connecting");
    setError(null);

    // Every buzz lock this client has been told about, in arrival order: each
    // active_games Realtime row and each hydrate snapshot. Ordered by arrival,
    // not by React commits, so a frame that landed while its render was still
    // pending is not mistaken for a lost one.
    type LockObservation = { seq: number; lock: string | null; round: number; realtime: boolean };
    let lockSeq = 0;
    const lockLog: LockObservation[] = [];
    function observeLock(row: ActiveGame, realtime: boolean): number {
      lockSeq += 1;
      lockLog.push({
        seq: lockSeq,
        lock: row.buzzed_team_id ?? null,
        round: row.round_number,
        realtime,
      });
      if (lockLog.length > LOCK_LOG_SIZE) lockLog.shift();
      return lockSeq;
    }
    // Did Realtime itself deliver the repaired state `fresh` after this client
    // learned `stale` (its last sighting before the snapshot `snapshotSeq`)?
    // Only the same lock in the same round counts. A different team's buzz or
    // the next round's start is a later write, and says nothing about whether
    // the clear before it was delivered.
    function realtimeDelivered(stale: string, fresh: ActiveGame, snapshotSeq: number): boolean {
      const freshLock = fresh.buzzed_team_id ?? null;
      let learnedSeq = 0;
      for (const o of lockLog) {
        if (o.seq < snapshotSeq && o.lock === stale) learnedSeq = o.seq;
      }
      return lockLog.some(
        (o) =>
          o.realtime &&
          o.seq > learnedSeq &&
          o.lock === freshLock &&
          o.round === fresh.round_number,
      );
    }
    const confirmTimers = new Set<number>();
    // Diagnostic for #254: a backstop tick found a different lock in the DB
    // than the one held here. The poll has already repaired the state. Warn
    // only if Realtime never delivers the repaired value within
    // STALE_LOCK_CONFIRM_MS, i.e. the event really was lost. This warning is
    // what makes dropped Realtime events visible in Grafana.
    function confirmStaleLock(stale: string, fresh: ActiveGame, snapshotSeq: number): void {
      if (realtimeDelivered(stale, fresh, snapshotSeq)) return;
      const id = window.setTimeout(() => {
        confirmTimers.delete(id);
        if (cancelled || realtimeDelivered(stale, fresh, snapshotSeq)) return;
        log("warn", "stale_buzz_lock_resynced", {
          game_code: gameCode,
          stale_team: stale,
          fresh_team: fresh.buzzed_team_id ?? "none",
        });
      }, STALE_LOCK_CONFIRM_MS);
      confirmTimers.add(id);
    }

    function dispatchOrQueue(action: GameAction): void {
      if (cancelled || goneTornDown) return;
      if (!hydrated) {
        if (pending.length >= MAX_PENDING_EVENTS) {
          // Hydrate has been failing long enough for the queue to overflow.
          // Dropping the backlog alone would be the same silent loss this
          // queue exists to prevent, so also request a fresh snapshot: it
          // supersedes every dropped event, and events arriving after its
          // reads re-queue and drain on top of it as usual.
          pending.length = 0;
          void hydrate();
        }
        pending.push(action);
        return;
      }
      dispatch(action);
      // A later snapshot can trust rows read after these frames arrived.
      if (inFlightHydrates === 0 || lastAppliedHydrateId === hydrateRequestId) return;
      if (action.type === "GAME_CHANGE" && action.payload.eventType !== "DELETE") {
        const row = action.payload.new as ActiveGame;
        if (!gameChange || !gameIsOlder(row, gameChange.row)) {
          gameChange = { requestId: hydrateRequestId, row };
        }
      } else if (action.type === "TEAM_CHANGE") {
        rememberRowChange(teamChanges, action.payload, hydrateRequestId);
      } else if (action.type === "ROUND_CHANGE") {
        rememberRowChange(roundChanges, action.payload, hydrateRequestId);
        if (action.payload.eventType === "INSERT") {
          const row = action.payload.new as GameRound;
          if (row.round_number >= (roundInsert?.row.round_number ?? 0)) {
            roundInsert = { requestId: hydrateRequestId, row };
          }
        }
      }
    }

    const filter = `game_code=eq.${gameCode}`;
    type LooseChannel = {
      on: (
        event: string,
        opts: { event: string; schema: string; table: string; filter: string },
        cb: (payload: PostgresChangePayload<unknown>) => void,
      ) => LooseChannel;
      subscribe: (cb: (status: string) => void | Promise<void>) => LooseChannel;
    };
    const channel = (supabase.channel(`game:${gameCode}`) as unknown as LooseChannel)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "active_games", filter },
        (payload) => {
          const typed = payload as PostgresChangePayload<ActiveGame>;
          observeServerTime(typed.commit_timestamp);
          recordFanout("game", typed.commit_timestamp);
          // Resolve the local player's open buzz span the moment we see the
          // lock land (won if it's our team, lost_race otherwise).
          if (typed.eventType === "DELETE") {
            markGone();
            return;
          }
          const row = typed.new as ActiveGame;
          if (row.buzz_attempt_id !== undefined) gameColumns = attemptColumns;
          observeLock(row, true);
          if (row.buzzed_team_id) {
            resolveBuzzE2E(row.buzzed_team_id, typed.commit_timestamp);
          }
          dispatchOrQueue({ type: "GAME_CHANGE", payload: typed });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_teams", filter },
        (payload) => {
          const typed = payload as PostgresChangePayload<Team>;
          observeServerTime(typed.commit_timestamp);
          recordFanout("team", typed.commit_timestamp);
          dispatchOrQueue({ type: "TEAM_CHANGE", payload: typed });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_rounds", filter },
        (payload) => {
          const typed = payload as PostgresChangePayload<GameRound>;
          observeServerTime(typed.commit_timestamp);
          recordFanout("round", typed.commit_timestamp);
          // Resolve any open score span for this round (click → ROUND_CHANGE).
          if (typed.eventType !== "DELETE") {
            const row = typed.new as GameRound;
            if (row.id) resolveScoreE2E(row, typed.commit_timestamp);
          }
          dispatchOrQueue({ type: "ROUND_CHANGE", payload: typed });
        },
      )
      .subscribe((subStatus) => {
        // Ignore channel-status callbacks once we've deliberately torn down on
        // 'gone': removeChannel() fires a CLOSED callback, and letting it run
        // would flip status "gone" -> "idle" and replace the "game has ended"
        // banner with a stuck "Connecting…" state.
        if (cancelled || goneTornDown) return;
        if (subStatus === "SUBSCRIBED") {
          realtimeDisconnected = false;
          setStatus("subscribed");
          void hydrate();
        } else if (subStatus === "CHANNEL_ERROR" || subStatus === "TIMED_OUT") {
          log("warn", "realtime_disconnect", { game_code: gameCode, sub_status: subStatus });
          realtimeDisconnected = true;
          setStatus("reconnecting");
        } else if (subStatus === "CLOSED") {
          realtimeDisconnected = true;
          setStatus("idle");
        }
      });

    function subscribeToBuzzLocks(): void {
      if (buzzChannel) return;
      buzzChannel = supabase
        .channel(`buzz:${gameCode}`, { config: { private: true } })
        .on("broadcast", { event: "buzz_locked" }, ({ payload }) => {
          if (isBuzzLock(payload)) {
            if (payload.buzz_attempt_id !== undefined) gameColumns = attemptColumns;
            dispatchOrQueue({ type: "BUZZ_LOCK", lock: payload });
          }
        })
        .subscribe();
    }

    async function readGame() {
      const query = (columns: string) =>
        supabase.from("active_games").select(columns).eq("game_code", gameCode).maybeSingle();
      let columns = gameColumns;
      let result = await query(columns);
      while (result.error?.code === "42703" && columns !== ACTIVE_GAME_COLUMNS) {
        if (columns === gameColumns) {
          // Preview can run ahead of either migration. Keep Broadcast if available.
          gameColumns =
            columns === attemptColumns && !result.error.message.includes("buzz_revision")
              ? revisionColumns
              : ACTIVE_GAME_COLUMNS;
        }
        columns = gameColumns;
        result = await query(columns);
      }
      return result;
    }

    // Paint an early snapshot immediately, in parallel with the WebSocket
    // handshake, rather than waiting for the SUBSCRIBED callback: the three
    // state GETs overlap the ~300-800ms Realtime connect (worse on mobile), so
    // the BUZZ button renders a full round-trip sooner. This is a *pre-hydrate*
    // (authoritative:false): it only renders an early snapshot. It does NOT
    // open the event gate, so live events still queue for the authoritative
    // SUBSCRIBED hydrate to drain ON TOP, and a pre-hydrate that resolves after
    // that hydrate drops its now-stale snapshot instead of clobbering newer
    // state. HYDRATE is idempotent, so when nothing changed in the handshake
    // window the SUBSCRIBED re-hydrate forces no extra render.
    void hydrate({ authoritative: false });

    // Periodic catch-up in case a Realtime event was dropped (see comments on
    // RESYNC_INTERVAL_MS / LOCKED_RESYNC_INTERVAL_MS). Idempotent — HYDRATE
    // returns the same state ref when nothing changed, so quiet ticks cost
    // ~3 REST queries with zero re-renders. One interval at the tight cadence;
    // it hydrates every tick while disconnected or holding a buzz lock and
    // every Nth tick otherwise (the 60s quiet cadence).
    const quietEveryNthTick = RESYNC_INTERVAL_MS / LOCKED_RESYNC_INTERVAL_MS;
    let resyncId: number | null = null;
    function startResync(): void {
      if (resyncId !== null) return;
      let tick = 0;
      resyncId = window.setInterval(() => {
        if (cancelled) return;
        tick += 1;
        if (
          realtimeDisconnected ||
          gameRef.current?.buzzed_team_id != null ||
          tick % quietEveryNthTick === 0
        ) {
          void hydrate({ resync: true });
        }
      }, LOCKED_RESYNC_INTERVAL_MS);
    }
    function stopResync(): void {
      if (resyncId !== null) {
        window.clearInterval(resyncId);
        resyncId = null;
      }
    }
    // The game is permanently gone: stop the backstop and drop the Realtime
    // channel so we don't poll + hold a subscription for a game that no longer
    // exists (an overnight display on an ended game was doing exactly that).
    // Idempotent; the effect cleanup also removes the channel (harmless twice).
    function teardownLive(): void {
      if (goneTornDown) return;
      goneTornDown = true;
      stopResync();
      if (buzzChannel) void supabase.removeChannel(buzzChannel);
      void supabase.removeChannel(
        channel as unknown as Parameters<typeof supabase.removeChannel>[0],
      );
    }
    function markGone(): void {
      if (cancelled || goneTornDown) return;
      setStatus("gone");
      dispatch({ type: "GAME_DELETED" });
      pending.length = 0;
      teardownLive();
    }
    // Pause the backstop on background tabs (display in another window, a
    // player who switched to another app). When the tab becomes visible
    // again we hydrate once immediately then resume the interval — so the
    // user never sees a stale snapshot when they return.
    function onVisibilityChange(): void {
      if (cancelled || goneTornDown) return;
      if (document.hidden) {
        stopResync();
      } else {
        void hydrate();
        startResync();
      }
    }
    if (!document.hidden) startResync();
    document.addEventListener("visibilitychange", onVisibilityChange);

    // An `authoritative` hydrate (the default: SUBSCRIBED, the backstop, and
    // the visibility resume) opens the event gate — on a snapshot that
    // actually committed it flips `hydrated` and drains the pending queue, so
    // queued live events are applied ON TOP of the snapshot and can never be
    // reverted by it. A FAILED authoritative hydrate keeps the gate closed:
    // events keep queuing for the next attempt (SUBSCRIBED after a reconnect,
    // the backstop tick, the visibility resume, or a queue-overflow resync).
    // Flipping the flag on failure — the old behavior — dispatched every
    // subsequent live event against null state, where the reducer's null
    // guards silently discarded them until a manual refresh (F-P1-1).
    // The mount pre-hydrate passes `authoritative: false`: it paints an early
    // snapshot for a faster first render but keeps the gate closed (events
    // stay queued for the SUBSCRIBED hydrate to drain), and if it resolves
    // after an authoritative hydrate it drops its now-stale snapshot rather
    // than clobbering newer state.
    async function hydrate({
      authoritative = true,
      resync = false,
      checkUnlock = false,
    }: { authoritative?: boolean; resync?: boolean; checkUnlock?: boolean } = {}) {
      if (cancelled || goneTornDown) return;
      const requestId = ++hydrateRequestId;
      inFlightHydrates += 1;
      const recoveryPoll = resync && realtimeDisconnected;
      // One slow table read can hold an older snapshot past a newer poll.
      const ignoreResult = () =>
        cancelled ||
        goneTornDown ||
        requestId < lastAppliedHydrateId ||
        (recoveryPoll && !realtimeDisconnected);
      try {
        const [gameRes, teamsRes, roundsRes] = await Promise.all([
          readGame(),
          supabase.from("game_teams").select("*").eq("game_code", gameCode),
          supabase.from("game_rounds").select("*").eq("game_code", gameCode),
        ]);
        if (ignoreResult()) return;
        if (authoritative || !hydrated) {
          if (gameRes.error) throw gameRes.error;
          if (teamsRes.error) throw teamsRes.error;
          if (roundsRes.error) throw roundsRes.error;
          if (!gameRes.data) {
            // Only an authoritative hydrate acts on a missing row; a pre-hydrate
            // stays silent so a transient miss can't briefly flash "gone".
            if (authoritative) markGone();
          } else {
            // Cast via unknown: a non-literal select() string makes
            // supabase-js infer GenericStringError rather than a row shape.
            const freshGame = gameRes.data as unknown as ActiveGame;
            if (freshGame.buzz_revision !== undefined) subscribeToBuzzLocks();
            lastAppliedHydrateId = requestId;
            let game = freshGame;
            if (
              gameChange &&
              gameChange.requestId >= requestId &&
              gameChange.row.round_number >= game.round_number &&
              !gameIsOlder(gameChange.row, game) &&
              (game.status !== "ended" || gameChange.row.status === "ended")
            ) {
              game = gameChange.row;
            }
            if (roundInsert && roundInsert.requestId >= requestId && game.status !== "ended") {
              game = deriveRoundAdvance(game, roundInsert.row);
            }
            // Only a lock taken from the snapshot can be a backstop repair.
            const lastGame = gameRef.current;
            if (game === freshGame && (!lastGame || !gameIsOlder(freshGame, lastGame))) {
              const snapshotSeq = observeLock(freshGame, false);
              const lastLock = lastGame?.buzzed_team_id;
              if (resync && lastLock && freshGame.buzzed_team_id !== lastLock) {
                confirmStaleLock(lastLock, freshGame, snapshotSeq);
              }
            }
            dispatch({
              type: "HYDRATE",
              game,
              teams: mergeSnapshotRows((teamsRes.data ?? []) as Team[], teamChanges, requestId),
              rounds: mergeSnapshotRows(
                (roundsRes.data ?? []) as GameRound[],
                roundChanges,
                requestId,
              ),
            });
            if (authoritative) {
              hydrated = true;
              setError(null);
              for (const action of pending) {
                dispatch(action);
              }
              pending.length = 0;
            }
            // A delayed frame can disagree with a newer REST unlock. Check once
            // in the background so a dropped clear does not wait another tick.
            if (
              !checkingUnlock &&
              requestId === hydrateRequestId &&
              game.buzzed_team_id !== null &&
              freshGame.buzzed_team_id === null
            ) {
              checkingUnlock = true;
              void hydrate({ resync: true, checkUnlock: true }).finally(() => {
                checkingUnlock = false;
              });
            }
          }
        }
      } catch (e) {
        // A pre-hydrate failure is silent (the SUBSCRIBED / backstop hydrate
        // retries); only an authoritative failure surfaces an error. Either
        // way the gate stays closed so live events keep queuing.
        if (authoritative && !checkUnlock && !ignoreResult())
          setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        inFlightHydrates -= 1;
        if (inFlightHydrates === 0 || lastAppliedHydrateId === hydrateRequestId) {
          gameChange = undefined;
          roundInsert = undefined;
          teamChanges.clear();
          roundChanges.clear();
        }
      }
    }

    refreshRef.current = () => {
      gameColumns = attemptColumns;
      return hydrate({ resync: true });
    };
    return () => {
      cancelled = true;
      refreshRef.current = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopResync();
      for (const id of confirmTimers) window.clearTimeout(id);
      if (buzzChannel && !goneTornDown) void supabase.removeChannel(buzzChannel);
      void supabase.removeChannel(
        channel as unknown as Parameters<typeof supabase.removeChannel>[0],
      );
    };
  }, [gameCode]);

  return {
    state,
    status,
    error,
    finalBoard,
    refresh: async () => {
      await refreshRef.current?.();
    },
  };
}
