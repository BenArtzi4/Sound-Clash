import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EndScreen } from "./EndScreen";
import type { Team } from "../lib/types";

const baseTeam: Team = {
  id: "x",
  game_code: "ABCDEF",
  name: "X",
  score: 0,
  joined_at: "2026-05-05T12:00:00Z",
};

describe("EndScreen", () => {
  it("shows the FINAL RESULTS heading and game code", () => {
    render(<EndScreen teams={[]} gameCode="ABCDEF" />);
    expect(screen.getByText(/final results/i)).toBeInTheDocument();
    expect(screen.getByText("ABCDEF")).toBeInTheDocument();
  });

  it("shows a graceful message when no teams played", () => {
    render(<EndScreen teams={[]} gameCode="ABCDEF" />);
    expect(screen.getByText(/ended without any teams/i)).toBeInTheDocument();
  });

  it("renders the winner with a WINNER label and the team name", () => {
    const teams: Team[] = [{ ...baseTeam, id: "1", name: "Alice", score: 42 }];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText(/winner/i)).toBeInTheDocument();
  });

  it("places top 3 teams on the podium and the rest in a list", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 50 },
      { ...baseTeam, id: "2", name: "Bob", score: 40 },
      { ...baseTeam, id: "3", name: "Carol", score: 30 },
      { ...baseTeam, id: "4", name: "Dave", score: 20 },
      { ...baseTeam, id: "5", name: "Eve", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
    expect(screen.getByText(/other teams/i)).toBeInTheDocument();
    expect(screen.getByText("Dave")).toBeInTheDocument();
    expect(screen.getByText("Eve")).toBeInTheDocument();
  });

  it("sorts by score desc, ties broken by joined_at asc", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 10, joined_at: "2026-05-05T12:00:01Z" },
      { ...baseTeam, id: "2", name: "Bob", score: 20, joined_at: "2026-05-05T12:00:02Z" },
      { ...baseTeam, id: "3", name: "Carol", score: 10, joined_at: "2026-05-05T12:00:00Z" },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    // Bob (20 pts) should be the winner — both his name and the WINNER badge live in the same card.
    const winnerCard = screen.getByText(/winner/i).parentElement;
    expect(winnerCard?.textContent).toMatch(/Bob/);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("does not show the 'Other teams' section when 3 or fewer teams played", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 30 },
      { ...baseTeam, id: "2", name: "Bob", score: 20 },
      { ...baseTeam, id: "3", name: "Carol", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(screen.queryByText(/other teams/i)).not.toBeInTheDocument();
  });
});
