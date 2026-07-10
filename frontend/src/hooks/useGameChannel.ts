import { useEffect, useReducer, useState } from "react";
import { supabase } from "../lib/supabase";
import type {
  ActiveGame,
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

function activeGameEqual(a: ActiveGame, b: ActiveGame): boolean {
  if (
    a.game_code !== b.game_code ||
    a.status !== b.status ||
    a.round_number !== b.round_number ||
    a.current_song_id !== b.current_song_id ||
    a.current_round_id !== b.current_round_id ||
    a.buzzed_team_id !== b.buzzed_team_id ||
    a.locked_at !== b.locked_at ||
    a.started_at !== b.started_at ||
    a.ended_at !== b.ended_at ||
    a.expires_at !== b.expires_at
  ) {
    return false;
  }
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
      if (state !== null && hydrateUnchanged(state, action.game, action.teams, action.rounds)) {
        return state;
      }
      const teams = new Map(action.teams.map((t) => [t.id, t]));
      const rounds = [...action.rounds].sort((a, b) => a.round_number - b.round_number);
      const currentRound = rounds.find((r) => r.id === action.game.current_round_id) ?? null;
      return { game: action.game, teams, rounds, currentRound };
    }
    case "GAME_CHANGE": {
      if (state === null) return null;
      const { eventType, new: row } = action.payload;
      if (eventType === "DELETE") return null;
      const game = row as ActiveGame;
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
        const currentRound = state.game.current_round_id === round.id ? round : state.currentRound;
        return { ...state, rounds: merged, currentRound };
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
} {
  const [state, dispatch] = useReducer(gameReducer, null);
  const [status, setStatus] = useState<ChannelStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

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

    function dispatchOrQueue(action: GameAction): void {
      if (cancelled) return;
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
          if (typed.eventType !== "DELETE") {
            const row = typed.new as ActiveGame;
            if (row.buzzed_team_id) {
              resolveBuzzE2E(row.buzzed_team_id, typed.commit_timestamp);
            }
          }
          dispatchOrQueue({ type: "GAME_CHANGE", payload: typed });
          if (typed.eventType === "DELETE") {
            setStatus("gone");
            teardownLive();
          }
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
            if (row.id) resolveScoreE2E(row.id, typed.commit_timestamp);
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
          setStatus("subscribed");
          void hydrate();
        } else if (subStatus === "CHANNEL_ERROR" || subStatus === "TIMED_OUT") {
          log("warn", "realtime_disconnect", { game_code: gameCode, sub_status: subStatus });
          setStatus("reconnecting");
        } else if (subStatus === "CLOSED") {
          setStatus("idle");
        }
      });

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

    // Periodic catch-up in case a Realtime event was dropped (see comment on
    // RESYNC_INTERVAL_MS). Idempotent — HYDRATE returns the same state ref
    // when nothing changed, so quiet ticks cost ~3 REST queries with zero
    // re-renders.
    let resyncId: number | null = null;
    function startResync(): void {
      if (resyncId !== null) return;
      resyncId = window.setInterval(() => {
        if (!cancelled) void hydrate();
      }, RESYNC_INTERVAL_MS);
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
      void supabase.removeChannel(
        channel as unknown as Parameters<typeof supabase.removeChannel>[0],
      );
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
    async function hydrate({ authoritative = true }: { authoritative?: boolean } = {}) {
      try {
        const [gameRes, teamsRes, roundsRes] = await Promise.all([
          supabase
            .from("active_games")
            .select(ACTIVE_GAME_COLUMNS)
            .eq("game_code", gameCode)
            .maybeSingle(),
          supabase.from("game_teams").select("*").eq("game_code", gameCode),
          supabase.from("game_rounds").select("*").eq("game_code", gameCode),
        ]);
        if (!cancelled && (authoritative || !hydrated)) {
          if (gameRes.error) throw gameRes.error;
          if (teamsRes.error) throw teamsRes.error;
          if (roundsRes.error) throw roundsRes.error;
          if (!gameRes.data) {
            // Only an authoritative hydrate acts on a missing row; a pre-hydrate
            // stays silent so a transient miss can't briefly flash "gone".
            if (authoritative) {
              setStatus("gone");
              dispatch({ type: "GAME_DELETED" });
              teardownLive();
              // The game is authoritatively gone and the channel is torn
              // down: nothing further arrives, and the queued events describe
              // a deleted game — close out the queue for good.
              hydrated = true;
              pending.length = 0;
            }
          } else {
            dispatch({
              type: "HYDRATE",
              // Cast via unknown: a non-literal select() string makes
              // supabase-js infer GenericStringError rather than a row shape.
              game: gameRes.data as unknown as ActiveGame,
              teams: (teamsRes.data ?? []) as Team[],
              rounds: (roundsRes.data ?? []) as GameRound[],
            });
            if (authoritative) {
              hydrated = true;
              setError(null);
              for (const action of pending) {
                dispatch(action);
              }
              pending.length = 0;
            }
          }
        }
      } catch (e) {
        // A pre-hydrate failure is silent (the SUBSCRIBED / backstop hydrate
        // retries); only an authoritative failure surfaces an error. Either
        // way the gate stays closed so live events keep queuing.
        if (!cancelled && authoritative) setError(e instanceof Error ? e : new Error(String(e)));
      }
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopResync();
      void supabase.removeChannel(
        channel as unknown as Parameters<typeof supabase.removeChannel>[0],
      );
    };
  }, [gameCode]);

  return { state, status, error, finalBoard };
}
