// Module-scope mirror of sessionStorage's admin password. Lib code (api.ts)
// reads via getAdminPassword without importing React; AuthProvider keeps the
// mirror in sync with both sessionStorage and React state.

const KEY = "auth:adminPassword";

let cached: string | null = readFromStorage();

function readFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(KEY);
}

export function getAdminPassword(): string | null {
  return cached;
}

export function setAdminPassword(value: string | null): void {
  cached = value;
  if (typeof window === "undefined") return;
  if (value === null) {
    window.sessionStorage.removeItem(KEY);
  } else {
    window.sessionStorage.setItem(KEY, value);
  }
}
