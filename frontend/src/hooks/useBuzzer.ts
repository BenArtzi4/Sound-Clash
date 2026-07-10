import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { failBuzz, markBuzzStart, tracedRpc } from "../lib/telemetry";
import { throwOnRpcError } from "../lib/rpcError";
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
  lockedTeamId: string | null;
  error: Error | null;
} {
  const [isBuzzing, setIsBuzzing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Provisional lock painted from the buzz_in RPC result the instant it
  // resolves -- a full Realtime fan-out (~200-300ms) before the active_games
  // UPDATE echoes back to this tab. buzz_in RETURNS (locked, locked_team_id,
  // locked_at): locked_team_id is the definitive round winner whether we won
  // OR lost the race, so we can flip the button to YOU BUZZED / SOMEONE ELSE
  // immediately instead of waiting for our own Realtime echo. Reconciled by
  // the effect below: any change to the authoritative Realtime lock clears the
  // guess, so a wrong optimistic paint is always corrected by the DB truth.
  const [provisionalLock, setProvisionalLock] = useState<string | null>(null);
  // Synchronous in-flight guard so two rapid clicks can't both fire; React
  // state updates aren't applied between the two calls within the same tick.
  const inFlightRef = useRef(false);

  const realtimeLock = gameState?.game.buzzed_team_id ?? null;
  // Authoritative Realtime state always wins; the provisional guess only fills
  // the gap before the first UPDATE for this round's lock lands.
  const effectiveLock = realtimeLock ?? provisionalLock;
  const isLocked = effectiveLock != null;
  const lockedByMe = effectiveLock === teamId;
  const isPlaying = gameState?.game.status === "playing";

  // Realtime is the source of truth. The instant it moves (a lock lands, the
  // manager releases it, the round advances) drop the provisional guess so it
  // can never override newer authoritative state -- this is what corrects a
  // wrong optimistic paint.
  useEffect(() => {
    setProvisionalLock(null);
  }, [realtimeLock]);

  const roundNumber = gameState?.game.round_number;
  const buzz = useCallback(async () => {
    if (inFlightRef.current || isLocked || !isPlaying) return;
    inFlightRef.current = true;
    setIsBuzzing(true);
    setError(null);
    // Open the end-to-end buzz span here (closest we get to the pointerdown --
    // the handler runs synchronously off it). It is resolved in useGameChannel
    // when this client observes the buzz lock in Realtime (won / lost_race).
    markBuzzStart(gameCode, teamId, roundNumber);
    try {
      const { data, error: rpcError } = await tracedRpc("buzz_in", { game_code: gameCode }, () =>
        supabase.rpc("buzz_in", {
          p_game_code: gameCode,
          p_team_id: teamId,
        }),
      );
      // Wrap in the shared RpcError so the buzz path throws the same error
      // type as the manager RPCs (uniform error branching / telemetry).
      throwOnRpcError(rpcError);
      // Paint the provisional lock from the RPC result immediately. The
      // Realtime UPDATE on active_games (applied by useGameChannel to
      // gameState) remains the source of truth and reconciles this a fan-out
      // later; the effect above drops the guess the moment it lands.
      const row = (Array.isArray(data) ? data[0] : data) as BuzzResult | null | undefined;
      if (row && row.locked_team_id != null) {
        setProvisionalLock(row.locked_team_id);
      }
    } catch (e) {
      failBuzz(teamId);
      // Roll back any optimistic state so the button returns to BUZZ and the
      // player can retry.
      setProvisionalLock(null);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      inFlightRef.current = false;
      setIsBuzzing(false);
    }
  }, [gameCode, teamId, roundNumber, isLocked, isPlaying]);

  return { buzz, isBuzzing, isLocked, lockedByMe, lockedTeamId: effectiveLock, error };
}

export type { BuzzResult };
