import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGameSounds } from "./useGameSounds";

interface FakeOsc {
  type: string;
  frequency: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface FakeGain {
  gain: {
    setValueAtTime: ReturnType<typeof vi.fn>;
    linearRampToValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}

let oscCount = 0;
let lastCtx: FakeAudioContext | null = null;

class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {});
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastCtx = this;
  }
  createOscillator(): FakeOsc {
    oscCount += 1;
    return {
      type: "sine",
      frequency: {
        value: 0,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(() => ({ connect: vi.fn() })),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain(): FakeGain {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(() => ({ connect: vi.fn() })),
    };
  }
}

beforeEach(() => {
  oscCount = 0;
  lastCtx = null;
  (window as unknown as { AudioContext: typeof FakeAudioContext }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useGameSounds", () => {
  it("prime() resumes a suspended audio context", async () => {
    const { result } = renderHook(() => useGameSounds());
    await act(async () => {
      result.current.prime();
    });
    expect(lastCtx).not.toBeNull();
    expect(lastCtx?.resume).toHaveBeenCalled();
  });

  it("playBuzz / playAward / playRoundStart no-op when context is suspended", () => {
    const { result } = renderHook(() => useGameSounds());
    act(() => {
      result.current.playBuzz();
      result.current.playAward();
      result.current.playRoundStart();
    });
    // No oscillators created because context never became running.
    expect(oscCount).toBe(0);
  });

  it("playBuzz creates an oscillator once the context is running", async () => {
    const { result } = renderHook(() => useGameSounds());
    await act(async () => {
      result.current.prime();
    });
    act(() => {
      result.current.playBuzz();
    });
    expect(oscCount).toBeGreaterThanOrEqual(1);
  });

  it("playAward emits two staggered oscillators", async () => {
    const { result } = renderHook(() => useGameSounds());
    await act(async () => {
      result.current.prime();
    });
    const before = oscCount;
    act(() => {
      result.current.playAward();
    });
    expect(oscCount - before).toBe(2);
  });

  it("playRoundStart emits a rising sine sweep", async () => {
    const { result } = renderHook(() => useGameSounds());
    await act(async () => {
      result.current.prime();
    });
    const before = oscCount;
    act(() => {
      result.current.playRoundStart();
    });
    expect(oscCount - before).toBe(1);
  });
});
