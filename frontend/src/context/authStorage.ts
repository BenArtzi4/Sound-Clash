// In-memory cache for the admin password. Lib code (api.ts) reads via
// getAdminPassword without importing React; AuthProvider keeps the cache in
// sync with React state. Intentionally NOT persisted to sessionStorage —
// keeping the shared secret out of browser storage means a hard refresh
// requires re-login, which is acceptable for a single-session manager flow.

let cached: string | null = null;

export function getAdminPassword(): string | null {
  return cached;
}

export function setAdminPassword(value: string | null): void {
  cached = value;
}
