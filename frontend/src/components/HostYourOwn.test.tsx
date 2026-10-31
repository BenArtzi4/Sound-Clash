import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const qr = vi.hoisted(() => ({ useQrSvg: vi.fn(() => ({ svg: "<svg></svg>", error: null })) }));
vi.mock("../hooks/useQrSvg", () => qr);
const funnel = vi.hoisted(() => ({ trackCta: vi.fn() }));
vi.mock("../lib/funnel", () => funnel);

import { HostYourOwnCard, HostYourOwnTv, TV_DELAY_MS } from "./HostYourOwn";

afterEach(() => {
  vi.useRealTimers();
});

describe("HostYourOwnCard", () => {
  it("invites a player to host and counts the click", () => {
    render(
      <MemoryRouter>
        <HostYourOwnCard />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: /host your own game/i });
    expect(link).toHaveAttribute("href", "/");
    expect(screen.getByText(/no app and no sign-up/i)).toBeInTheDocument();
    fireEvent.click(link);
    expect(funnel.trackCta).toHaveBeenCalledWith("end_host_your_own");
  });
});

describe("HostYourOwnTv", () => {
  it("points the QR at the site with its own tag", () => {
    render(<HostYourOwnTv />);
    expect(qr.useQrSvg).toHaveBeenLastCalledWith(`${window.location.origin}/?src=tv-end`, 200);
    expect(screen.getByText("Host your own game")).toBeInTheDocument();
  });

  it("keeps its place but stays invisible until the podium has played out", () => {
    vi.useFakeTimers();
    const { container } = render(<HostYourOwnTv />);
    const strip = container.querySelector("aside");
    expect(strip).not.toHaveAttribute("data-shown");
    expect(strip).toHaveAttribute("aria-hidden", "true");

    act(() => {
      vi.advanceTimersByTime(TV_DELAY_MS - 1);
    });
    expect(strip).not.toHaveAttribute("data-shown");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(strip).toHaveAttribute("data-shown", "true");
    expect(strip).toHaveAttribute("aria-hidden", "false");
  });
});
