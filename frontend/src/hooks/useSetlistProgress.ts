// The host console's progress line for a game from the host's own songs
// ("Your songs: 12 of 35 left"): game_pool_summary (migration 060) called
// direct from the browser via Supabase PostgREST RPC, same pattern as
// peekNextSongDirect.
//
// The RPC answers zero rows for a normal genre game, and PostgREST answers
// PGRST202 on a database without the function. Either one means this game
// never has a line, so the hook stops asking for it: a normal game makes one
// call per console mount and none per round. Any other error shows nothing
// and is tried again on the next round. Nothing here toasts.

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { tracedRpc } from "../lib/telemetry";
import { RpcError, throwOnRpcError } from "../lib/rpcError";

export interface SetlistProgress {
  listTotal: number;
  listSongs: number;
  listLeft: number;
  extraSongs: number;
  extraLeft: number;
}

interface GamePoolSummaryRow {
  list_total: number;
  list_songs: number;
  list_left: number;
  extra_songs: number;
  extra_left: number;
}

// `noList`: this game will never have a line (zero rows or PGRST202).
interface Answer {
  progress: SetlistProgress | null;
  noList: boolean;
}

async function gamePoolSummaryDirect(
  gameCode: string,
  managerToken: string,
): Promise<SetlistProgress | null> {
  const { data, error } = await tracedRpc("game_pool_summary", { game_code: gameCode }, () =>
    supabase.rpc("game_pool_summary", {
      p_game_code: gameCode,
      p_manager_token: managerToken,
    }),
  );
  throwOnRpcError(error);
  const row = (Array.isArray(data) ? data[0] : data) as GamePoolSummaryRow | null | undefined;
  if (!row) return null;
  return {
    listTotal: row.list_total,
    listSongs: row.list_songs,
    listLeft: row.list_left,
    extraSongs: row.extra_songs,
    extraLeft: row.extra_left,
  };
}

function askForSummary(gameCode: string, managerToken: string): Promise<Answer> {
  return gamePoolSummaryDirect(gameCode, managerToken).then(
    (progress) => ({ progress, noList: progress === null }),
    (err: unknown) => ({
      progress: null,
      noList: err instanceof RpcError && err.sqlstate === "PGRST202",
    }),
  );
}

export function useSetlistProgress(
  gameCode: string,
  managerToken: string | null,
  roundNumber: number,
): SetlistProgress | null {
  // Tagged with its game, so a new game code never shows the old game's line.
  const [shown, setShown] = useState<{ gameCode: string; progress: SetlistProgress } | null>(null);
  // The game that answered "no list": later rounds ask nothing for it.
  const noListFor = useRef<string | null>(null);
  // The request in flight and what it asks. StrictMode's second run of the
  // mount effect reuses it, so the dev build also makes one call per mount.
  const inFlight = useRef<{ key: string; answer: Promise<Answer> } | null>(null);

  useEffect(() => {
    if (!managerToken || noListFor.current === gameCode) return;
    const key = JSON.stringify([gameCode, managerToken, roundNumber]);
    let answer = inFlight.current?.key === key ? inFlight.current.answer : null;
    if (!answer) {
      const started = askForSummary(gameCode, managerToken);
      inFlight.current = { key, answer: started };
      void started.then(() => {
        if (inFlight.current?.answer === started) inFlight.current = null;
      });
      answer = started;
    }
    // Only the newest request of a mounted hook may change what it shows.
    let current = true;
    void answer.then(({ progress, noList }) => {
      if (!current) return;
      if (noList) noListFor.current = gameCode;
      setShown(progress ? { gameCode, progress } : null);
    });
    return () => {
      current = false;
    };
  }, [gameCode, managerToken, roundNumber]);

  if (!managerToken || shown?.gameCode !== gameCode) return null;
  return shown.progress;
}
