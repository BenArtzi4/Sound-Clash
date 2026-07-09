import { fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpiryCountdown, WARNING_WINDOW_MS } from "./ExpiryCountdown";
import { _resetServerTime } from "../hooks/useServerTime";

// All times are computed against fake timers pinned to NOW; with no observed
// commit_timestamp the server-offset clock falls through to Date.now(), so
// the maths below are deterministic.
const NOW = Date.parse("2026-05-05T12:00:00.000Z");

function iso(msFromNow: number): string {
  return new Date(NOW + msFromNow).toISOString();
}

describe("ExpiryCountdown", () => {
  beforeEach(() => {
    _resetServerTime();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the subtle end-time hint (no button) while more than 20 minutes remain", () => {
    render(
      <ExpiryCountdown expiresAt={iso(60 * 60_000)} extendPending={false} onExtend={() => {}} />,
    );
    expect(screen.getByTestId("expiry-hint")).toHaveTextContent(/ends at/i);
    expect(screen.queryByTestId("expiry-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("extend-game")).not.toBeInTheDocument();
  });

  it("shows the warning banner with an m:ss countdown inside the final 20 minutes", () => {
    render(
      <ExpiryCountdown expiresAt={iso(15 * 60_000)} extendPending={false} onExtend={() => {}} />,
    );
    const banner = screen.getByTestId("expiry-banner");
    expect(banner).toHaveTextContent("Game expires in 15:00");
    expect(screen.getByTestId("extend-game")).toBeEnabled();

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(banner).toHaveTextContent("Game expires in 13:59");
  });

  it("ticks across the threshold: the hint becomes the banner as the window is entered", () => {
    render(
      <ExpiryCountdown
        expiresAt={iso(WARNING_WINDOW_MS + 30_000)}
        extendPending={false}
        onExtend={() => {}}
      />,
    );
    expect(screen.getByTestId("expiry-hint")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.queryByTestId("expiry-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("expiry-banner")).toBeInTheDocument();
  });

  it("keeps the banner and the action for an overdue-but-unswept game", () => {
    // The pg_cron sweep is hourly, so a game can outlive its expires_at by up
    // to ~an hour; extending is still possible (and most valuable) there.
    render(
      <ExpiryCountdown expiresAt={iso(-5 * 60_000)} extendPending={false} onExtend={() => {}} />,
    );
    expect(screen.getByTestId("expiry-banner")).toHaveTextContent(/may close at any moment/i);
    expect(screen.getByTestId("extend-game")).toBeEnabled();
  });

  it("fires onExtend on click and disables the button while the extend is pending", () => {
    const onExtend = vi.fn();
    const { rerender } = render(
      <ExpiryCountdown expiresAt={iso(10 * 60_000)} extendPending={false} onExtend={onExtend} />,
    );
    fireEvent.click(screen.getByTestId("extend-game"));
    expect(onExtend).toHaveBeenCalledTimes(1);

    rerender(
      <ExpiryCountdown expiresAt={iso(10 * 60_000)} extendPending={true} onExtend={onExtend} />,
    );
    expect(screen.getByTestId("extend-game")).toBeDisabled();
  });

  it("returns to the subtle hint when the bumped expires_at arrives", () => {
    // Simulates the Realtime UPDATE landing after a successful extend_game.
    const { rerender } = render(
      <ExpiryCountdown expiresAt={iso(10 * 60_000)} extendPending={false} onExtend={() => {}} />,
    );
    expect(screen.getByTestId("expiry-banner")).toBeInTheDocument();

    rerender(
      <ExpiryCountdown expiresAt={iso(70 * 60_000)} extendPending={false} onExtend={() => {}} />,
    );
    expect(screen.queryByTestId("expiry-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("expiry-hint")).toBeInTheDocument();
  });
});
