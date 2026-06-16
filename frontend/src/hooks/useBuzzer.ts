import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { failBuzz, markBuzzStart, tracedRpc } from "../lib/telemetry";
import type { BuzzResult, GameState } from "../lib/types";

export function useBuzzer(
  gameCode: string,
  teamId: string,
  gameState: GameState | null,
): {
  buzz: () => Promise<void>;
  isBuzzing: boolean;
  isLocked: boolean;
  lockedByMe: boolean;
  error: Error | null;
} {
  const [isBuzzing, setIsBuzzing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Synchronous in-flight guard so two rapid clicks can't both fire; React
  // state updates aren't applied between the two calls within the same tick.
  const inFlightRef = useRef(false);

  const isLocked = gameState?.game.buzzed_team_id != null;
  const lockedByMe = gameState?.game.buzzed_team_id === teamId;
  const isPlaying = gameState?.game.status === "playing";

  const roundNumber = gameState?.game.round_number;
  const buzz = useCallback(async () => {
    if (inFlightRef.current || isLocked || !isPlaying) return;
    inFlightRef.current = true;
    setIsBuzzing(true);
    setError(null);
    // Open the end-to-end buzz span here (closest we get to the pointerdown —
    // the handler runs synchronously off it). It is resolved in useGameChannel
    // when this client observes the buzz lock in Realtime (won / lost_race).
    markBuzzStart(gameCode, teamId, roundNumber);
    try {
      const { error: rpcError } = await tracedRpc("buzz_in", { game_code: gameCode }, () =>
        supabase.rpc("buzz_in", {
          p_game_code: gameCode,
          p_team_id: teamId,
        }),
      );
      if (rpcError) throw rpcError;
      // We deliberately do not act on the BuzzResult here; the source of
      // truth is the Realtime UPDATE on active_games, which useGameChannel
      // applies to gameState. This keeps the UI consistent across all tabs.
    } catch (e) {
      failBuzz(teamId);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      inFlightRef.current = false;
      setIsBuzzing(false);
    }
  }, [gameCode, teamId, roundNumber, isLocked, isPlaying]);

  return { buzz, isBuzzing, isLocked, lockedByMe, error };
}

export type { BuzzResult };
