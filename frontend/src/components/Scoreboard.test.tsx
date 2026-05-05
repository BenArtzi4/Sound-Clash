import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
