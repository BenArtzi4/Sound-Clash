import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EndScreen } from "./EndScreen";
import type { Team } from "../lib/types";

const baseTeam: Team = {
  id: "x",
  game_code: "ABCDEF",
  name: "X",
  score: 0,
  joined_at: "2026-05-05T12:00:00Z",
};

const realMatchMedia = window.matchMedia;

describe("EndScreen", () => {
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it("fits the frame only in the display's version", () => {
    const { container, rerender } = render(<EndScreen teams={[]} gameCode="ABCDEF" />);
    const shell = container.firstElementChild!;
    expect(shell).not.toHaveAttribute("data-fit");
    expect(shell.className).not.toMatch(/_fit_/);
    rerender(<EndScreen teams={[]} gameCode="ABCDEF" fit />);
    expect(container.firstElementChild).toHaveAttribute("data-fit", "true");
    expect(container.firstElementChild!.className).toMatch(/_fit_/);
  });

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

  it("places top 3 on the podium and lists the top 5 in the scoreboard", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 50 },
      { ...baseTeam, id: "2", name: "Bob", score: 40 },
      { ...baseTeam, id: "3", name: "Carol", score: 30 },
      { ...baseTeam, id: "4", name: "Dave", score: 20 },
      { ...baseTeam, id: "5", name: "Eve", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    // Nothing hidden (5 <= cap) -> the list is the full field under the "Leaderboard" heading.
    expect(screen.getByRole("heading", { level: 2, name: /^leaderboard$/i })).toBeInTheDocument();
    const scoreboard = screen.getByTestId("final-scoreboard");
    expect(scoreboard.querySelectorAll("[data-team-id]")).toHaveLength(5);
    expect(scoreboard.textContent).toMatch(/Alice/);
    expect(scoreboard.textContent).toMatch(/Dave/);
    expect(scoreboard.textContent).toMatch(/Eve/);
    // Exactly 5 teams -> nothing hidden, no "…and N more" note.
    expect(screen.queryByTestId("final-scoreboard-more")).not.toBeInTheDocument();
  });

  it("caps the scoreboard at the top 5 and summarizes the rest", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 70 },
      { ...baseTeam, id: "2", name: "Bob", score: 60 },
      { ...baseTeam, id: "3", name: "Carol", score: 50 },
      { ...baseTeam, id: "4", name: "Dave", score: 40 },
      { ...baseTeam, id: "5", name: "Eve", score: 30 },
      { ...baseTeam, id: "6", name: "Frank", score: 20 },
      { ...baseTeam, id: "7", name: "Grace", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    // Teams are hidden -> same "Leaderboard" heading; the cut is carried by the "…and N more" note.
    expect(screen.getByRole("heading", { level: 2, name: /^leaderboard$/i })).toBeInTheDocument();
    const scoreboard = screen.getByTestId("final-scoreboard");
    // Only the top 5 render as rows; the last two are summarized.
    expect(scoreboard.querySelectorAll("[data-team-id]")).toHaveLength(5);
    expect(scoreboard.querySelector('[data-team-id="6"]')).toBeNull();
    expect(scoreboard.querySelector('[data-team-id="7"]')).toBeNull();
    expect(screen.getByTestId("final-scoreboard-more")).toHaveTextContent(/and 2 more teams/i);
  });

  it("keeps a tie whole when it straddles the top-5 cut line", () => {
    // Ranks 1-4 are distinct; two teams tie at rank 5 and one trails at rank 6.
    // The rank-5 tie must not be split across the cut, so both tied teams show;
    // only the rank-6 team is summarized.
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 50 },
      { ...baseTeam, id: "2", name: "Bob", score: 40 },
      { ...baseTeam, id: "3", name: "Carol", score: 30 },
      { ...baseTeam, id: "4", name: "Dave", score: 20 },
      { ...baseTeam, id: "5", name: "Eve", score: 10 },
      { ...baseTeam, id: "6", name: "Frank", score: 10 },
      { ...baseTeam, id: "7", name: "Grace", score: 5 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    const scoreboard = screen.getByTestId("final-scoreboard");
    // 6 rows: the two rank-5 teams are both kept.
    expect(scoreboard.querySelectorAll("[data-team-id]")).toHaveLength(6);
    expect(scoreboard.querySelector('[data-team-id="5"]')?.getAttribute("data-rank")).toBe("5");
    expect(scoreboard.querySelector('[data-team-id="6"]')?.getAttribute("data-rank")).toBe("5");
    expect(scoreboard.querySelector('[data-team-id="7"]')).toBeNull();
    // One team below the cut -> singular "team".
    expect(screen.getByTestId("final-scoreboard-more")).toHaveTextContent(/and 1 more team$/i);
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

  it("lists a tie as one group over the shared score in the display's version", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 30 },
      { ...baseTeam, id: "2", name: "Bob", score: 30 },
      { ...baseTeam, id: "3", name: "Carol", score: 10 },
    ];
    const { container } = render(<EndScreen teams={teams} gameCode="ABCDEF" fit />);
    const winnersCard = screen.getByText(/winners/i).parentElement!;
    const names = [...winnersCard.querySelectorAll("[dir=auto]")].map((n) => n.textContent);
    expect(names).toEqual(["Alice", "Bob"]);
    // One score for the pair, not one per team.
    expect(winnersCard.textContent?.match(/30/g)).toHaveLength(1);
    // Each team still has its own leaderboard row, and the leaderboard knows
    // how many rows it has (the fitted rows size themselves from it, and on an
    // upright frame the leaderboard's flex size asks the podium for room).
    const board = container.querySelector('[data-testid="final-scoreboard"]') as HTMLElement;
    expect(board.querySelectorAll("li")).toHaveLength(3);
    expect(board.style.getPropertyValue("--rows")).toBe("3");
  });

  it("keeps one entry per tied team on the phones' version", () => {
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 30 },
      { ...baseTeam, id: "2", name: "Bob", score: 30 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    const winnersCard = screen.getByText(/winners/i).parentElement!;
    expect(winnersCard.querySelectorAll("[dir=auto]")).toHaveLength(0);
    expect(winnersCard.textContent?.match(/30/g)).toHaveLength(2);
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

  it("shows every tied team on the podium and never hides a higher scorer", () => {
    // Regression: a 4-way tie for 2nd must show all four on the silver card —
    // a higher-scoring tied team (Eve, 30) must not be hidden while a
    // lower-scoring team (Frank, 10) keeps its own bronze card.
    const teams: Team[] = [
      { ...baseTeam, id: "1", name: "Alice", score: 50 },
      { ...baseTeam, id: "2", name: "Bob", score: 30 },
      { ...baseTeam, id: "3", name: "Carol", score: 30 },
      { ...baseTeam, id: "4", name: "Dave", score: 30 },
      { ...baseTeam, id: "5", name: "Eve", score: 30 },
      { ...baseTeam, id: "6", name: "Frank", score: 10 },
    ];
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    // No "+N more tied" collapse anywhere.
    expect(screen.queryByText(/more tied/i)).not.toBeInTheDocument();
    // Every team — including the tied runner-up Eve (30) — is on the podium,
    // so a lower-scoring team (Frank, 10) can't sit on the podium while a
    // higher-scoring tied team is hidden. The podium is the gold card's parent.
    const podium = screen.getByText("WINNER").parentElement?.parentElement;
    for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"]) {
      expect(podium?.textContent).toContain(name);
    }
  });

  it("shows all five teams when the whole field ties for first", () => {
    // The realistic ceiling is five teams sharing one score; they all fit on
    // the shared card (it grows to fit — no internal scroll).
    const teams: Team[] = [1, 2, 3, 4, 5].map((n) => ({
      ...baseTeam,
      id: `${n}`,
      name: `P${n}`,
      score: 30,
      joined_at: `2026-05-05T12:00:0${n}Z`,
    }));
    render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    const winnersCard = screen.getByText(/winners/i).parentElement;
    for (const name of ["P1", "P2", "P3", "P4", "P5"]) {
      expect(winnersCard?.textContent).toContain(name);
    }
  });

  it("shows final scores immediately for reduced-motion users (no count-up)", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    render(
      <EndScreen teams={[{ ...baseTeam, id: "1", name: "Alice", score: 42 }]} gameCode="ABCDEF" />,
    );
    // The gold podium score is a CountUp; with reduced motion it renders the
    // final value on first paint instead of rolling up from 0.
    const winnerCard = screen.getByText(/winner/i).parentElement;
    expect(winnerCard?.textContent).toMatch(/42/);
  });
});

// usePodiumFloor: jsdom has no layout, so the card and team-box heights come
// from stubbed getters keyed on the card's class (gold / silver / bronze).
describe("EndScreen podium floor (display, upright frames)", () => {
  const teams: Team[] = [
    { ...baseTeam, id: "1", name: "Winner", score: 30 },
    { ...baseTeam, id: "2", name: "Second", score: 20 },
    { ...baseTeam, id: "3", name: "TieA", score: 0 },
    { ...baseTeam, id: "4", name: "TieB", score: 0 },
  ];
  const place = (el: HTMLElement | null) =>
    el?.closest("[data-podium-card]")?.className.match(/_(gold|silver|bronze)_/)?.[1];
  // offsetHeight of each card; [scrollHeight, clientHeight] of its team box.
  let cardH: Record<string, number> = { gold: 140, silver: 110, bronze: 300 };
  let boxH: Record<string, [number, number]> = {
    gold: [90, 60],
    silver: [40, 40],
    bronze: [500, 100],
  };
  const props = ["offsetHeight", "scrollHeight", "clientHeight"] as const;
  const saved = props.map((p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p));
  const observers: Array<{ cb: () => void; observed: HTMLElement[]; disconnected: boolean }> = [];

  beforeEach(() => {
    cardH = { gold: 140, silver: 110, bronze: 300 };
    boxH = { gold: [90, 60], silver: [40, 40], bronze: [500, 100] };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-podium-card") ? (cardH[place(this) ?? ""] ?? 0) : 0;
      },
    });
    for (const [i, p] of (["scrollHeight", "clientHeight"] as const).entries()) {
      Object.defineProperty(HTMLElement.prototype, p, {
        configurable: true,
        get(this: HTMLElement) {
          return this.hasAttribute("data-podium-teams") ? (boxH[place(this) ?? ""]?.[i] ?? 0) : 0;
        },
      });
    }
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        entry: { cb: () => void; observed: HTMLElement[]; disconnected: boolean };
        constructor(cb: () => void) {
          this.entry = { cb, observed: [], disconnected: false };
          observers.push(this.entry);
        }
        observe(el: HTMLElement) {
          this.entry.observed.push(el);
        }
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
  });

  afterEach(() => {
    props.forEach((p, i) => {
      const d = saved[i];
      if (d) Object.defineProperty(HTMLElement.prototype, p, d);
      else Reflect.deleteProperty(HTMLElement.prototype, p);
    });
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "fonts");
  });

  const podiumOf = (container: HTMLElement) =>
    container.querySelector("[data-podium-card]")!.parentElement as HTMLElement;

  it("marks the cards, and only a tie's card as a tie", () => {
    const { container } = render(<EndScreen teams={teams} gameCode="ABCDEF" fit />);
    const cards = [...container.querySelectorAll("[data-podium-card]")];
    expect(cards.map((c) => place(c as HTMLElement))).toEqual(["silver", "gold", "bronze"]);
    expect(cards.map((c) => c.hasAttribute("data-tie"))).toEqual([false, false, true]);
    expect(cards.every((c) => c.querySelector("[data-podium-teams]"))).toBe(true);
  });

  it("floors the podium at the tallest one-team card's natural height, skipping a tie", () => {
    const { container } = render(<EndScreen teams={teams} gameCode="ABCDEF" fit />);
    // gold: 140 + (90 - 60) hidden = 170; silver: 110; the 300px tie is skipped.
    expect(podiumOf(container).style.getPropertyValue("--podium-floor")).toBe("170px");
  });

  it("re-measures when the frame resizes, and stops when unmounted", () => {
    const { container, unmount } = render(<EndScreen teams={teams} gameCode="ABCDEF" fit />);
    const podium = podiumOf(container);
    const observer = observers.at(-1)!;
    expect(observer.observed).toEqual([podium.parentElement]);
    cardH.silver = 190;
    observer.cb();
    expect(podium.style.getPropertyValue("--podium-floor")).toBe("190px");
    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it("re-measures once the fonts have loaded, unless it has gone", async () => {
    let loaded!: () => void;
    const ready = new Promise<void>((resolve) => (loaded = resolve));
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    const { container } = render(<EndScreen teams={teams} gameCode="ABCDEF" fit />);
    const podium = podiumOf(container);
    boxH.gold = [120, 60];
    loaded();
    await ready;
    await Promise.resolve();
    expect(podium.style.getPropertyValue("--podium-floor")).toBe("200px");

    let loaded2!: () => void;
    const ready2 = new Promise<void>((resolve) => (loaded2 = resolve));
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: ready2 } });
    const second = render(<EndScreen teams={teams} gameCode="GHIJKL" fit />);
    const podium2 = podiumOf(second.container);
    second.unmount();
    boxH.gold = [400, 60];
    loaded2();
    await ready2;
    await Promise.resolve();
    expect(podium2.style.getPropertyValue("--podium-floor")).toBe("200px");
  });

  it("still sets the floor once where ResizeObserver is missing", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { container } = render(<EndScreen teams={teams} gameCode="ABCDEF" fit />);
    expect(podiumOf(container).style.getPropertyValue("--podium-floor")).toBe("170px");
  });

  it("leaves the phones' version alone", () => {
    const { container } = render(<EndScreen teams={teams} gameCode="ABCDEF" />);
    expect(podiumOf(container).style.getPropertyValue("--podium-floor")).toBe("");
    expect(observers).toHaveLength(0);
  });
});
