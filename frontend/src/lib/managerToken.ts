// Per-game manager token storage. The host's browser receives a token
// from POST /games and persists it under `game:<code>:manager-token`,
// mirroring the team-storage pattern in JoinTeamPage / TeamGameplayPage.
// Manager-only API calls (select-song, award-points, end, kick-team) read
// the token from here and forward it as the X-Manager-Token header.
//
// Persisting in localStorage means a hard refresh keeps the host signed in
// for as long as the game is alive (game rows auto-expire after 4 hours via
// pg_cron, at which point the token becomes meaningless and the next
// manager API call will 404).

function managerKey(gameCode: string): string {
  return `game:${gameCode}:manager-token`;
}

export function getManagerToken(gameCode: string): string | null {
  try {
    return window.localStorage.getItem(managerKey(gameCode));
  } catch {
    return null;
  }
}

export function setManagerToken(gameCode: string, token: string): void {
  try {
    window.localStorage.setItem(managerKey(gameCode), token);
  } catch {
    // Storage may be unavailable (private mode, quota); the host can still
    // play in the current tab — they just can't refresh.
  }
}

export function clearManagerToken(gameCode: string): void {
  try {
    window.localStorage.removeItem(managerKey(gameCode));
  } catch {
    // ignore
  }
}
