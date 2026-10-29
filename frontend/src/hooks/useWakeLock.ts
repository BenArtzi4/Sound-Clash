import { useEffect } from "react";

// Keeps the screen on while `active` (Screen Wake Lock API). The display is
// often a phone mirrored to the TV, or a laptop on HDMI: if that screen dims
// or locks mid-game the TV goes dark. The browser drops the lock whenever the
// page is hidden, so it is taken again each time the page becomes visible.
// Where the API is missing or the request is refused (battery saver, an old
// browser) this does nothing: the board still works, the device may just
// sleep on its own timer.
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let held: { release(): Promise<void> } | null = null;
    let pending = false;
    let cancelled = false;

    const acquire = () => {
      if (cancelled || held || pending || document.visibilityState !== "visible") return;
      pending = true;
      navigator.wakeLock.request("screen").then(
        (sentinel) => {
          pending = false;
          if (cancelled) {
            void sentinel.release().catch(() => {});
            return;
          }
          held = sentinel;
          sentinel.addEventListener("release", () => {
            if (held === sentinel) held = null;
          });
        },
        () => {
          pending = false;
        },
      );
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      if (held) void held.release().catch(() => {});
      held = null;
    };
  }, [active]);
}
