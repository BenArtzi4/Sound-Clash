// In-memory admin password store for the song-catalog UI.
//
// Held in a module-scoped variable on purpose; never localStorage,
// never sessionStorage. The admin password is operator-wide and longer
// lived than a per-game manager token; persisting it in browser storage
// would re-open the credential-leak surface that CodeQL flagged when
// the in-tab manager-password gate previously used sessionStorage
// (see .claude/rules/lessons-learned.md, 2026-05-05 entry).
//
// A hard refresh requires re-entering the password; acceptable for an
// admin flow that runs from a single bookmarked URL.

let _password: string | null = null;

export function getAdminPassword(): string | null {
  return _password;
}

export function setAdminPassword(value: string): void {
  _password = value;
}

export function clearAdminPassword(): void {
  _password = null;
}
