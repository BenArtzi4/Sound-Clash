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
import { observeServerTime } from "./useServerTime";

export type ChannelStatus = "idle" | "connecting" | "subscribed" | "reconnecting" | "gone";

// Backstop re-fetch interval. Supabase Realtime over WebSocket occasionally
// drops a postgres_changes event (flaky networks, a missed heartbeat that
// silently re-joins, the free tier under load) — and a missed "a team buzzed"
// event would strand the manager with greyed-out scoring buttons until the
// next state change. So every 20 seconds we re-hydrate from the tables; the
// reducer's HYDRATE skips the dispatch when nothing material changed, so a
// quiet round costs ~3 REST queries per 20s with zero re-renders. Migrations
// 009/010 fixed the original Realtime-event-loss bugs, so the resync is now a
// true safety net, not the primary sync path.
const RESYNC_INTERVAL_MS = 20_000;

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
  return (
    a.id === b.id && a.name === b.name && a.score === b.score && a.joined_at === b.joined_at
  );
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
// hits this path for every quiet 20s interval — Scoreboard, BuzzButton, the
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
} {
  const [state, dispatch] = useReducer(gameReducer, null);
  const [status, setStatus] = useState<ChannelStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!gameCode) return;
    let cancelled = false;
    let hydrated = false;
    // Realtime events that arrive between SUBSCRIBED and HYDRATE land on
    // state===null and are dropped by the reducer's null guards. Queue them
    // here and replay after HYDRATE; gameReducer is idempotent so replay is safe.
    const pending: GameAction[] = [];
    setStatus("connecting");
    setError(null);

    function dispatchOrQueue(action: GameAction): void {
      if (cancelled) return;
      if (!hydrated) {
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
          dispatchOrQueue({ type: "GAME_CHANGE", payload: typed });
          if (typed.eventType === "DELETE") setStatus("gone");
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_teams", filter },
        (payload) => {
          const typed = payload as PostgresChangePayload<Team>;
          observeServerTime(typed.commit_timestamp);
          dispatchOrQueue({ type: "TEAM_CHANGE", payload: typed });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_rounds", filter },
        (payload) => {
          const typed = payload as PostgresChangePayload<GameRound>;
          observeServerTime(typed.commit_timestamp);
          dispatchOrQueue({ type: "ROUND_CHANGE", payload: typed });
        },
      )
      .subscribe((subStatus) => {
        if (cancelled) return;
        if (subStatus === "SUBSCRIBED") {
          setStatus("subscribed");
          void hydrate();
        } else if (subStatus === "CHANNEL_ERROR" || subStatus === "TIMED_OUT") {
          setStatus("reconnecting");
        } else if (subStatus === "CLOSED") {
          setStatus("idle");
        }
      });

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
    // Pause the backstop on background tabs (display in another window, a
    // player who switched to another app). When the tab becomes visible
    // again we hydrate once immediately then resume the interval — so the
    // user never sees a stale snapshot when they return.
    function onVisibilityChange(): void {
      if (cancelled) return;
      if (document.hidden) {
        stopResync();
      } else {
        void hydrate();
        startResync();
      }
    }
    if (!document.hidden) startResync();
    document.addEventListener("visibilitychange", onVisibilityChange);

    async function hydrate() {
      try {
        const [gameRes, teamsRes, roundsRes] = await Promise.all([
          supabase.from("active_games").select("*").eq("game_code", gameCode).maybeSingle(),
          supabase.from("game_teams").select("*").eq("game_code", gameCode),
          supabase.from("game_rounds").select("*").eq("game_code", gameCode),
        ]);
        if (!cancelled) {
          if (gameRes.error) throw gameRes.error;
          if (teamsRes.error) throw teamsRes.error;
          if (roundsRes.error) throw roundsRes.error;
          if (!gameRes.data) {
            setStatus("gone");
            dispatch({ type: "GAME_DELETED" });
          } else {
            dispatch({
              type: "HYDRATE",
              game: gameRes.data as ActiveGame,
              teams: (teamsRes.data ?? []) as Team[],
              rounds: (roundsRes.data ?? []) as GameRound[],
            });
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
      }
      hydrated = true;
      if (!cancelled) {
        for (const action of pending) {
          dispatch(action);
        }
      }
      pending.length = 0;
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

  return { state, status, error };
}
