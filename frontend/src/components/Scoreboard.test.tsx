import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scoreboard } from "./Scoreboard";
import type { Team } from "../lib/types";

const baseTeam: Team = {
  id: "1",
  game_code: "ABCDEF",
  name: "A",
  score: 0,
  joined_at: "2026-05-05T12:00:00Z",
};

describe("Scoreboard", () => {
  it("shows empty state when no teams", () => {
    render(<Scoreboard teams={[]} />);
    expect(screen.getByText(/no teams/i)).toBeInTheDocument();
  });

  it("sorts by score desc, ties broken by joined_at asc", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 10, joined_at: "2026-05-05T12:00:01Z" },
      { ...baseTeam, id: "2", name: "Bob", score: 20, joined_at: "2026-05-05T12:00:02Z" },
      { ...baseTeam, id: "3", name: "Carol", score: 10, joined_at: "2026-05-05T12:00:00Z" },
    ];
    render(<Scoreboard teams={teams} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Bob");
    expect(rows[1]).toHaveTextContent("Carol");
    expect(rows[2]).toHaveTextContent("Alice");
  });

  it("highlights the buzzed team via class change", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 5 },
      { ...baseTeam, id: "2", name: "Bob", score: 0 },
    ];
    render(<Scoreboard teams={teams} buzzedTeamId="2" />);
    const bob = screen.getByText("Bob").closest("li");
    expect(bob?.className).toMatch(/buzzed/);
  });

  it("renders the empty-state hint with share-the-code guidance", () => {
    render(<Scoreboard teams={[]} />);
    expect(screen.getByText(/share the game code/i)).toBeInTheDocument();
  });

  it("flashes the row when a team's score changes", () => {
    const initial: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 0 }];
    const { rerender } = render(<Scoreboard teams={initial} />);
    const row = screen.getByText("Alice").closest("li");
    expect(row?.className).not.toMatch(/flashing/);

    const updated: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 10 }];
    rerender(<Scoreboard teams={updated} />);
    const flashed = screen.getByText("Alice").closest("li");
    expect(flashed?.className).toMatch(/flashing/);
  });

  describe("score-change announcement", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("announces a score gain via the live region", () => {
      const initial: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 0 }];
      const { rerender } = render(<Scoreboard teams={initial} />);
      expect(screen.getByTestId("scoreboard-announcement").textContent).toBe("");

      const updated: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 10 }];
      rerender(<Scoreboard teams={updated} />);
      expect(screen.getByTestId("scoreboard-announcement").textContent).toBe(
        "Alice gained 10 points to 10",
      );
    });

    it("announces a score loss with absolute delta", () => {
      const initial: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 10 }];
      const { rerender } = render(<Scoreboard teams={initial} />);
      const updated: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 5 }];
      rerender(<Scoreboard teams={updated} />);
      expect(screen.getByTestId("scoreboard-announcement").textContent).toBe(
        "Alice lost 5 points to 5",
      );
    });

    it("clears the announcement after 700ms", () => {
      const initial: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 0 }];
      const { rerender } = render(<Scoreboard teams={initial} />);
      const updated: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 10 }];
      rerender(<Scoreboard teams={updated} />);
      expect(screen.getByTestId("scoreboard-announcement").textContent).not.toBe("");
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(screen.getByTestId("scoreboard-announcement").textContent).toBe("");
    });

    it("uses polite live-region semantics", () => {
      const teams: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 0 }];
      render(<Scoreboard teams={teams} />);
      const region = screen.getByTestId("scoreboard-announcement");
      expect(region).toHaveAttribute("aria-live", "polite");
      expect(region).toHaveAttribute("role", "status");
    });
  });
});
