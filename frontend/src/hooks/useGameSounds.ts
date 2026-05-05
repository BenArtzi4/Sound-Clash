import { useCallback, useEffect, useRef } from "react";

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

function getAudioCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WebkitWindow).webkitAudioContext ?? null;
}

export function useGameSounds() {
  const ctxRef = useRef<AudioContext | null>(null);

  function getCtx(): AudioContext | null {
    if (ctxRef.current) return ctxRef.current;
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    ctxRef.current = new Ctor();
    return ctxRef.current;
  }

  // Call on a user gesture to satisfy autoplay policies.
  const prime = useCallback(() => {
    const ac = getCtx();
    if (!ac) return;
    if (ac.state === "suspended") void ac.resume();
  }, []);

  const playBuzz = useCallback(() => {
    const ac = getCtx();
    if (!ac || ac.state !== "running") return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.18);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }, []);

  const playAward = useCallback(() => {
    const ac = getCtx();
    if (!ac || ac.state !== "running") return;
    const now = ac.currentTime;
    [880, 1320].forEach((freq, i) => {
      const start = now + i * 0.09;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain).connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  }, []);

  const playRoundStart = useCallback(() => {
    const ac = getCtx();
    if (!ac || ac.state !== "running") return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.22);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    return () => {
      void ctx?.close().catch(() => {});
    };
  }, []);

  return { prime, playBuzz, playAward, playRoundStart };
}
