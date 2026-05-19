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
    // Alice appears on both the podium and the full scoreboard row.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
    expect(screen.getByText(/winner/i)).toBeInTheDocument();
  });

  it("places top 3 teams on the podium and lists every team in the scoreboard", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 50 },
      { ...baseTeam, id: "2", name: "Bob", score: 40 },
      { ...baseTeam, id: "3", name: "Carol", score: 30 },
      { ...baseTeam, id: "4", name: "Dave", score: 20 },
      { ...baseTeam, id: "5", name: "Eve", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(screen.getByText(/full scoreboard/i)).toBeInTheDocument();
    const scoreboard = screen.getByTestId("final-scoreboard");
    expect(scoreboard.querySelectorAll("[data-team-id]")).toHaveLength(5);
    expect(scoreboard.textContent).toMatch(/Alice/);
    expect(scoreboard.textContent).toMatch(/Dave/);
    expect(scoreboard.textContent).toMatch(/Eve/);
  });

  it("sorts by score desc, ties broken by joined_at asc", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 10, joined_at: "2026-05-05T12:00:01Z" },
      { ...baseTeam, id: "2", name: "Bob", score: 20, joined_at: "2026-05-05T12:00:02Z" },
      { ...baseTeam, id: "3", name: "Carol", score: 10, joined_at: "2026-05-05T12:00:00Z" },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    // Bob (20 pts) should be the winner; both his name and the WINNER badge live in the same card.
    const winnerCard = screen.getByText(/winner/i).parentElement;
    expect(winnerCard?.textContent).toMatch(/Bob/);
    // Carol joined first so she sorts ahead of Alice on the tie at 10 pts.
    const scoreboard = screen.getByTestId("final-scoreboard");
    const rows = [...scoreboard.querySelectorAll("[data-team-id]")];
    expect(rows.map((r) => r.getAttribute("data-team-id"))).toEqual(["2", "3", "1"]);
  });

  it("scoreboard renders every team individually even when scores tie (regression)", () => {
    // Two teams tie at 20 → the podium collapses to two visible cards (gold +
    // silver, bronze becomes an invisible placeholder), which previously
    // made one team look 'missing'. The full scoreboard guarantees every
    // team is visible.
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 30 },
      { ...baseTeam, id: "2", name: "Bob", score: 20 },
      { ...baseTeam, id: "3", name: "Carol", score: 20 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    const scoreboard = screen.getByTestId("final-scoreboard");
    expect(scoreboard.querySelectorAll("[data-team-id]")).toHaveLength(3);
    // Tied teams share a rank, next rank is +1 (dense ranking).
    const aliceRow = scoreboard.querySelector('[data-team-id="1"]');
    const bobRow = scoreboard.querySelector('[data-team-id="2"]');
    const carolRow = scoreboard.querySelector('[data-team-id="3"]');
    expect(aliceRow?.getAttribute("data-rank")).toBe("1");
    expect(bobRow?.getAttribute("data-rank")).toBe("2");
    expect(carolRow?.getAttribute("data-rank")).toBe("2");
  });

  it("places multiple teams on the gold podium when tied for first", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 30 },
      { ...baseTeam, id: "2", name: "Bob", score: 30 },
      { ...baseTeam, id: "3", name: "Carol", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(screen.getByText(/winners/i)).toBeInTheDocument();
    expect(screen.queryByText(/^winner$/i)).not.toBeInTheDocument();
    // Both tied teams sit inside the same gold card.
    const winnersCard = screen.getByText(/winners/i).parentElement;
    expect(winnersCard?.textContent).toMatch(/Alice/);
    expect(winnersCard?.textContent).toMatch(/Bob/);
    // Carol (10 pts) also shows up in the scoreboard at rank 2 (dense ranking).
    const scoreboard = screen.getByTestId("final-scoreboard");
    expect(scoreboard.querySelector('[data-team-id="3"]')?.getAttribute("data-rank")).toBe("2");
  });

  it("ties at second/third stack on the same podium card", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 50 },
      { ...baseTeam, id: "2", name: "Bob", score: 30 },
      { ...baseTeam, id: "3", name: "Carol", score: 30 },
      { ...baseTeam, id: "4", name: "Dave", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    // Alice alone on gold.
    expect(screen.getByText(/^winner$/i)).toBeInTheDocument();
    // Bob and Carol share silver; Dave gets bronze. All four show in the
    // full scoreboard with dense ranks 1, 2, 2, 3.
    const scoreboard = screen.getByTestId("final-scoreboard");
    expect(scoreboard.querySelectorAll("[data-team-id]")).toHaveLength(4);
    expect(scoreboard.querySelector('[data-team-id="1"]')?.getAttribute("data-rank")).toBe("1");
    expect(scoreboard.querySelector('[data-team-id="2"]')?.getAttribute("data-rank")).toBe("2");
    expect(scoreboard.querySelector('[data-team-id="3"]')?.getAttribute("data-rank")).toBe("2");
    expect(scoreboard.querySelector('[data-team-id="4"]')?.getAttribute("data-rank")).toBe("3");
  });

  it("groups all teams on gold when everyone is tied", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 10 },
      { ...baseTeam, id: "2", name: "Bob", score: 10 },
      { ...baseTeam, id: "3", name: "Carol", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(screen.getByText(/winners/i)).toBeInTheDocument();
    const winnersCard = screen.getByText(/winners/i).parentElement;
    expect(winnersCard?.textContent).toMatch(/Alice/);
    expect(winnersCard?.textContent).toMatch(/Bob/);
    expect(winnersCard?.textContent).toMatch(/Carol/);
  });
});
