// Uniform error handling for the six browser-direct PostgREST RPCs (buzz_in,
// award_attempt, release_buzz_lock, select_next_song, peek_next_song,
// extend_game). PostgREST surfaces a failure as { code, message, details,
// hint }; a PL/pgSQL `RAISE EXCEPTION '<code>' USING ERRCODE = '<sqlstate>'`
// lands as `message = '<code>'` (e.g. 'manager_token_required',
// 'no_buzz_to_score'). Wrapping every RPC failure in the same RpcError type is
// what lets callers branch/toast uniformly on `err instanceof RpcError` and
// read `.message` / `.sqlstate` the same way regardless of which RPC failed
// (e.g. ManagerConsolePage's silent-skip vs error-toast handling).

export class RpcError extends Error {
  readonly sqlstate: string | undefined;
  constructor(message: string, sqlstate?: string) {
    super(message);
    this.name = "RpcError";
    this.sqlstate = sqlstate;
  }
}

// Throw a uniform RpcError when a PostgREST RPC returned an error. The param is
// typed structurally (not against supabase-js's PostgrestError) so this stays
// decoupled from the client; the real error carries `.message` + `.code`
// (sqlstate). A no-op when `error` is null so call sites read `throwOnRpcError(
// error)` right after destructuring `{ data, error }`.
export function throwOnRpcError(
  error: { message: string; code?: string } | null | undefined,
): void {
  if (error) {
    throw new RpcError(error.message, error.code);
  }
}
