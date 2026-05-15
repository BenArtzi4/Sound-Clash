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
// reducer's HYDRATE fully replaces state, so this is a cheap, idempotent
// catch-up. 20s is well inside a "huh, the page is stuck" wait while keeping
// the per-client REST load to ~3 queries / 20s instead of /5s — a 4x reduction
// in request count for a 10-minute game. Migrations 009/010 fixed the original
// Realtime-event-loss bugs, so the resync is now a true safety net, not the
// primary sync path.
const RESYNC_INTERVAL_MS = 20_000;

export function gameReducer(state: GameState | null, action: GameAction): GameState | null {
  switch (action.type) {
    case "HYDRATE": {
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
    // RESYNC_INTERVAL_MS). Idempotent — HYDRATE replaces state wholesale.
    const resyncId = window.setInterval(() => {
      if (!cancelled) void hydrate();
    }, RESYNC_INTERVAL_MS);

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
      window.clearInterval(resyncId);
      void supabase.removeChannel(
        channel as unknown as Parameters<typeof supabase.removeChannel>[0],
      );
    };
  }, [gameCode]);

  return { state, status, error };
}
