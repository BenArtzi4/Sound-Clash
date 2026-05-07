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
