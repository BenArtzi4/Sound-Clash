// Per-game team identity storage. After a player joins via JoinTeamPage,
// the team's id+name lives under `game:<code>:team` in localStorage so
// TeamGameplayPage can hydrate after a refresh. Game rows auto-expire
// after 4 hours via pg_cron, at which point the stored identity becomes
// meaningless and the next page load will redirect to the join screen.
//
// adminPassword.ts is intentionally NOT consolidated here; it lives in
// memory only (see .claude/rules/lessons-learned.md, 2026-05-05 entry).

export interface StoredTeam {
  id: string;
  name: string;
}

function teamKey(gameCode: string): string {
  return `game:${gameCode}:team`;
}

export function getStoredTeam(gameCode: string): StoredTeam | null {
  try {
    const raw = window.localStorage.getItem(teamKey(gameCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTeam>;
    if (!parsed.id || !parsed.name) return null;
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

export function setStoredTeam(gameCode: string, team: StoredTeam): void {
  try {
    window.localStorage.setItem(
      teamKey(gameCode),
      JSON.stringify({ id: team.id, name: team.name }),
    );
  } catch {
    // Storage may be unavailable (private mode, quota); the player can
    // still play in the current tab; they just can't refresh.
  }
}

export function clearStoredTeam(gameCode: string): void {
  try {
    window.localStorage.removeItem(teamKey(gameCode));
  } catch {
    // ignore
  }
}

// --- Team rejoin link (issue #183) ----------------------------------------
//
// A team that lost its device is rescued by the HOST: the manager console
// reveals that team's per-team rejoin token (from the anon-invisible
// team_secrets table) and renders a QR of the form
//   /join/<CODE>#rt=<rejoin_token>
// The team scans it on a new/borrowed device; JoinTeamPage adopts the token,
// calls POST /games/<CODE>/rejoin to resolve it back to the exact team (same
// id, preserved score), then stores the normal {id,name} identity and scrubs
// the fragment. The token rides the URL FRAGMENT, never the query string —
// fragments stay in the browser, so the token can't land in CDN/access logs or
// Referer headers. This mirrors the host's #mt= recovery link (managerToken.ts).
//
// Tokens are minted server-side by gen_random_uuid() (migration 046), so only
// accept the canonical UUID shape — a crafted link can't drive an arbitrary
// value into the rejoin request.
const REJOIN_HASH_RE = /^#rt=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function rejoinHash(token: string): string {
  return `#rt=${token}`;
}

export function parseRejoinHash(hash: string): string | null {
  const match = REJOIN_HASH_RE.exec(hash);
  return match ? (match[1] ?? null) : null;
}

export function teamRejoinUrl(gameCode: string, token: string): string {
  return `${window.location.origin}/join/${gameCode}${rejoinHash(token)}`;
}
