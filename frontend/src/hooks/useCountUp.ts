import { useEffect, useRef, useState } from "react";

function canAnimate(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    typeof window.requestAnimationFrame === "function"
  );
}

interface CountUpOptions {
  duration?: number;
  delay?: number;
  // Starting point for the FIRST animation. Omitted (the Display board) the
  // hook opens on the current value and only eases later changes; set to 0
  // (the final podium) it rolls up from zero on mount.
  from?: number;
}

// Eases a displayed number from its previous value to `value` over `duration`
// ms (rAF, cancelled on change/unmount). Display-only: never used on the buzz
// path. Jumps straight to the value under reduced motion or without matchMedia
// (jsdom), so tests and reduced-motion users always read the real total.
export function useCountUp(value: number, opts: CountUpOptions = {}): number {
  const { duration = 600, delay = 0, from } = opts;
  const [display, setDisplay] = useState(() => (from !== undefined && canAnimate() ? from : value));
  // Mirrors whatever number is currently on screen, so an animation always
  // starts from what the viewer can see. Updated wherever `display` is set,
  // never during render, and — the part that matters — never by the cleanup:
  // StrictMode mounts every effect twice, and a cleanup that jumped this to
  // the target would make the second run see "already there", bail, and
  // strand the display on its opening value.
  const displayRef = useRef(display);
  useEffect(() => {
    if (!canAnimate()) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const start = displayRef.current;
    if (start === value) return;
    let raf = 0;
    const timer = window.setTimeout(() => {
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const n = Math.round(start + (value - start) * eased);
        displayRef.current = n;
        setDisplay(n);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [value, duration, delay]);
  return display;
}
