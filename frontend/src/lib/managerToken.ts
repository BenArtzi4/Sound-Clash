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
    // play in the current tab; they just can't refresh.
  }
}

export function clearManagerToken(gameCode: string): void {
  try {
    window.localStorage.removeItem(managerKey(gameCode));
  } catch {
    // ignore
  }
}

// --- Host recovery link (T4.10) -------------------------------------------
//
// The console offers a "backup host link" of the form
//   /manager/game/<CODE>#mt=<manager_token>
// so a host whose localStorage is gone (new device, cleared browser, dead
// phone) can re-authenticate by opening the link. The token rides the URL
// FRAGMENT, never the query string: fragments stay in the browser, so the
// token can't land in CDN/access logs or Referer headers. The console page
// adopts the token into localStorage on load and then scrubs the fragment
// from the address bar.

// Tokens are minted server-side by gen_random_uuid() (migration 012/034), so
// only accept the canonical UUID shape — a crafted link can't plant arbitrary
// strings in storage.
const RECOVERY_HASH_RE = /^#mt=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function recoveryHash(token: string): string {
  return `#mt=${token}`;
}

export function parseRecoveryHash(hash: string): string | null {
  const match = RECOVERY_HASH_RE.exec(hash);
  return match ? (match[1] ?? null) : null;
}

export function managerRecoveryUrl(gameCode: string, token: string): string {
  return `${window.location.origin}/manager/game/${gameCode}${recoveryHash(token)}`;
}
