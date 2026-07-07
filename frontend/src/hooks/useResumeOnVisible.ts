import { useEffect, useRef } from "react";

/**
 * Run `resume` whenever the document becomes visible again — the host unlocked
 * their phone or refocused the tab — AND `shouldResume()` is true at that
 * moment. Mobile browsers pause media when a tab is backgrounded / the screen
 * locks and do NOT auto-resume on return, so without this the host is left with
 * a silently-paused song and the room goes quiet (see F-P1 "I-Resume").
 *
 * Both callbacks are read through refs kept current on every render, so the
 * single `visibilitychange` listener is registered once and always sees the
 * latest game state instead of re-subscribing on every state change.
 *
 * Best-effort: a browser that blocks programmatic playback (strict mobile
 * autoplay) is no worse off than the pre-existing silent-paused state.
 */
export function useResumeOnVisible(shouldResume: () => boolean, resume: () => void): void {
  const shouldResumeRef = useRef(shouldResume);
  const resumeRef = useRef(resume);
  useEffect(() => {
    shouldResumeRef.current = shouldResume;
    resumeRef.current = resume;
  });

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === "visible" && shouldResumeRef.current()) {
        resumeRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
}
