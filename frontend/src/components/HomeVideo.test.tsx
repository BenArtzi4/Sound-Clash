import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const funnel = vi.hoisted(() => ({ trackCta: vi.fn() }));
vi.mock("../lib/funnel", () => funnel);

import { HomeVideo } from "./HomeVideo";

const EMBED = "https://www.youtube-nocookie.com/embed/_vFY865K6Qc?autoplay=1&playsinline=1&rel=0";

describe("HomeVideo", () => {
  beforeEach(() => {
    funnel.trackCta.mockReset();
  });

  // Until the tap, Home must not load YouTube: no iframe, only the poster
  // (lazy, sized so it reserves its space) under a labelled play button.
  it("shows a poster and a play button, and no player, until tapped", () => {
    const { container } = render(<HomeVideo />);
    expect(container.querySelector("iframe")).toBeNull();
    const button = screen.getByRole("button", { name: /play the video: how to play sound clash/i });
    expect(button).toHaveAttribute("type", "button");
    const poster = button.querySelector("img");
    expect(poster).toHaveAttribute("src", "https://i.ytimg.com/vi/_vFY865K6Qc/oardefault.jpg");
    expect(poster).toHaveAttribute("loading", "lazy");
    expect(poster).toHaveAttribute("width", "720");
    expect(poster).toHaveAttribute("height", "1280");
    // Decorative: the button carries the name.
    expect(poster).toHaveAttribute("alt", "");
    expect(screen.getByText("How to play, in 20 seconds").tagName).toBe("FIGCAPTION");
    expect(funnel.trackCta).not.toHaveBeenCalled();
  });

  it("swaps in YouTube's player on a tap, counts the tap and moves focus to it", async () => {
    const user = userEvent.setup();
    const { container } = render(<HomeVideo />);
    await user.click(screen.getByRole("button", { name: /play the video/i }));

    const player = container.querySelector("iframe");
    expect(player).not.toBeNull();
    expect(player).toHaveAttribute("src", EMBED);
    expect(player).toHaveAttribute("title", "How to play Sound Clash (video)");
    expect(player?.getAttribute("allow")).toContain("autoplay");
    expect(player?.getAttribute("allow")).not.toContain("fullscreen");
    expect(player).toHaveAttribute("allowfullscreen");
    expect(player).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(document.activeElement).toBe(player);
    // Nothing of ours stays in the frame with the player (YouTube's rules).
    expect(player?.parentElement?.children).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(funnel.trackCta).toHaveBeenCalledTimes(1);
    expect(funnel.trackCta).toHaveBeenCalledWith("home_video_play");
  });

  it("plays from the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<HomeVideo />);
    await user.tab();
    expect(screen.getByRole("button", { name: /play the video/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(container.querySelector("iframe")).toHaveAttribute("src", EMBED);
    expect(funnel.trackCta).toHaveBeenCalledWith("home_video_play");
  });
});
