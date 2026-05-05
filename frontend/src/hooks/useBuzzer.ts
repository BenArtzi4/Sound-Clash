import { useCallback, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
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
  // Synchronous in-flight guard so two rapid clicks can't both fire — React
  // state updates aren't applied between the two calls within the same tick.
  const inFlightRef = useRef(false);

  const isLocked = gameState?.game.buzzed_team_id != null;
  const lockedByMe = gameState?.game.buzzed_team_id === teamId;
  const isPlaying = gameState?.game.status === "playing";

  const buzz = useCallback(async () => {
    if (inFlightRef.current || isLocked || !isPlaying) return;
    inFlightRef.current = true;
    setIsBuzzing(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc("buzz_in", {
        p_game_code: gameCode,
        p_team_id: teamId,
      });
      if (rpcError) throw rpcError;
      // We deliberately do not act on the BuzzResult here — the source of
      // truth is the Realtime UPDATE on active_games, which useGameChannel
      // applies to gameState. This keeps the UI consistent across all tabs.
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      inFlightRef.current = false;
      setIsBuzzing(false);
    }
  }, [gameCode, teamId, isLocked, isPlaying]);

  return { buzz, isBuzzing, isLocked, lockedByMe, error };
}

export type { BuzzResult };
