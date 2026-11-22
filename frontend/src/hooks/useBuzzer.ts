import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { failBuzz, markBuzzStart, tracedRpc } from "../lib/telemetry";
import { throwOnRpcError } from "../lib/rpcError";
import type { BuzzResult, GameState } from "../lib/types";

// How long a provisional (optimistic) lock may live unconfirmed before it
// self-expires. The guess exists only to bridge the ~200-300ms Realtime
// fan-out gap between buzz_in resolving over REST and the active_games UPDATE
// echoing back over the WebSocket, so anything older than a couple of seconds
// is always stale -- the authoritative echo was lost (a dropped Realtime frame
// or a silently half-open socket during a WS-only outage, the #254
// "reconnecting" state) and will never arrive. Expiring it re-arms the button
// instead of stranding a team on "SOMEONE ELSE BUZZED" for the rest of an open
// round (issue #261). The real ~300ms echo always beats this by ~8x, so the
// happy path never sees the timeout fire. Exported so the test can advance
// fake timers by exactly one TTL.
export const PROVISIONAL_LOCK_TTL_MS = 2500;

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
  const authorityEpoch = useRef(0);

  const realtimeLock = gameState?.game.buzzed_team_id ?? null;
  const roundNumber = gameState?.game.round_number;
  // Authoritative Realtime state always wins; the provisional guess only fills
  // the gap before the first UPDATE for this round's lock lands.
  const effectiveLock = realtimeLock ?? provisionalLock;
  const isLocked = effectiveLock != null;
  const lockedByMe = effectiveLock === teamId;
  const isPlaying = gameState?.game.status === "playing";

  // A lock change or round advance supersedes provisional feedback, even if
  // the RPC response for that press is still on its way.
  useEffect(() => {
    authorityEpoch.current += 1;
    setProvisionalLock(null);
  }, [gameCode, isPlaying, realtimeLock, roundNumber]);

  // If both the lock and release were missed (#261), the provisional lock
  // expires so the button re-arms even without an authoritative change.
  useEffect(() => {
    if (provisionalLock === null) return;
    const timer = window.setTimeout(() => setProvisionalLock(null), PROVISIONAL_LOCK_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [provisionalLock]);

  const buzz = useCallback(async () => {
    if (inFlightRef.current || isLocked || !isPlaying) return;
    inFlightRef.current = true;
    const epochAtPress = authorityEpoch.current;
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
      if (row?.locked_team_id != null && authorityEpoch.current === epochAtPress) {
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
