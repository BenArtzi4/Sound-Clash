// Server-clock offset, computed from the first observed Realtime
// commit_timestamp. Subsequent observations are ignored — one measurement is
// enough to keep the manager's countdown consistent across tabs (see
// docs/realtime-design.md §8).

let offsetMs: number | null = null;

export function observeServerTime(commitTimestamp: string): void {
  if (offsetMs !== null) return;
  const parsed = Date.parse(commitTimestamp);
  if (Number.isNaN(parsed)) return;
  offsetMs = parsed - Date.now();
}

export function serverTimeNow(): Date {
  return new Date(Date.now() + (offsetMs ?? 0));
}

// For tests only.
export function _resetServerTime(): void {
  offsetMs = null;
}

export function useServerTime(): {
  serverTimeNow: () => Date;
  observeServerTime: (commitTimestamp: string) => void;
} {
  return { serverTimeNow, observeServerTime };
}
