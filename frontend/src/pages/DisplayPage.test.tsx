import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import {
  fireSubscribed,
  fireTeam,
  makeActiveGame,
  makePayload,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setHydrate,
  setSongFetch,
  setSongFetchFailures,
} from "../test/supabaseMock";
import { DisplayPage } from "./DisplayPage";

beforeEach(() => {
  resetSupabaseMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/display" element={<DisplayPage />} />
        <Route path="/display/:gameCode" element={<DisplayPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DisplayPage entry", () => {
  it("shows the entry form without a code", () => {
    renderAt("/display");
    expect(screen.getByPlaceholderText(/ABCDEF/i)).toBeInTheDocument();
  });

  it("disables Open until the code is valid", () => {
    renderAt("/display");
    const open = screen.getByRole("button", { name: /open/i });
    expect(open).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/ABCDEF/i), {
      target: { value: "abcdef" },
    });
    expect(open).toBeEnabled();
  });

  it("navigates to the board on submit", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing" }),
      teams: [makeTeam({ id: "t1", name: "Alice", score: 7 })],
      rounds: [],
    });
    renderAt("/display");
    fireEvent.change(screen.getByPlaceholderText(/ABCDEF/i), {
      target: { value: "ABCDEF" },
    });
    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
  });
});

describe("DisplayPage board", () => {
  it("renders waiting banner before the game starts", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/waiting for the host/i)).toBeInTheDocument();
  });

  it("renders the round banner during play", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 2 }),
      teams: [makeTeam()],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/round 2$/i)).toBeInTheDocument();
  });

  it("renders the buzzed banner when a team locks", async () => {
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/Alice buzzed in/i)).toBeInTheDocument();
  });

  it("renders the post-buzz countdown when the game is locked with a locked_at", async () => {
    // serverTimeNow is offset-anchored to the first commit_timestamp it sees;
    // making locked_at recent ensures the countdown sits inside (0, 10] sec.
    const lockedAt = new Date(Date.now() - 2_000).toISOString();
    setHydrate({
      game: makeActiveGame({
        status: "playing",
        buzzed_team_id: "t1",
        locked_at: lockedAt,
      }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const timer = screen.getByRole("timer", { name: /time remaining/i });
    const value = parseInt((timer.textContent ?? "").replace(/\D/g, ""), 10);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(10);
  });

  it("does not render the countdown when no team has buzzed yet", async () => {
    setHydrate({
      game: makeActiveGame({ status: "playing", buzzed_team_id: null, locked_at: null }),
      teams: [makeTeam({ id: "t1", name: "Alice" })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("renders the end-screen splash when the game is over", async () => {
    setHydrate({
      game: makeActiveGame({ status: "ended" }),
      teams: [makeTeam({ id: "t1", name: "Alice", score: 12 })],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/final results/i)).toBeInTheDocument();
    expect(screen.getByText(/winner/i)).toBeInTheDocument();
    // Alice appears on the podium and in the full scoreboard row.
    expect(screen.getAllByText("Alice").length).toBeGreaterThan(0);
  });

  it("renders an empty-board hint when no teams have joined", async () => {
    setHydrate({
      game: makeActiveGame({ status: "waiting" }),
      teams: [],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.getByText(/waiting for teams/i)).toBeInTheDocument();
  });

  it("pops a +N pill when a team's score goes up", async () => {
    const alice = makeTeam({ id: "t1", name: "Alice", score: 0 });
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [alice],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    expect(screen.queryByTestId("point-change")).not.toBeInTheDocument();

    act(() => {
      fireTeam(makePayload("game_teams", "UPDATE", { new: { ...alice, score: 10 } }));
    });
    const pill = await screen.findByTestId("point-change");
    expect(pill).toHaveTextContent("Alice");
    expect(pill).toHaveTextContent("+10");
  });

  it("pops a -N pill when a team's score goes down (wrong buzz)", async () => {
    const bravo = makeTeam({ id: "t2", name: "Bravo", score: 5 });
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams: [bravo],
      rounds: [],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });

    act(() => {
      fireTeam(makePayload("game_teams", "UPDATE", { new: { ...bravo, score: 2 } }));
    });
    const pill = await screen.findByTestId("point-change");
    expect(pill).toHaveTextContent("Bravo");
    expect(pill).toHaveTextContent("-3");
  });

  it("hides song title and artist behind ??? while no token is claimed", async () => {
    setSongFetch({
      id: "song-1",
      title: "Careless Whisper",
      artist: "George Michael",
      youtube_id: "izGwDsrQ1eQ",
    });
    setHydrate({
      game: makeActiveGame({ status: "playing", current_round_id: "round-1" }),
      teams: [makeTeam({ id: "t1", name: "Alpha" })],
      rounds: [
        makeRound({
          id: "round-1",
          song_id: "song-1",
          title_claimed_by: null,
          artist_claimed_by: null,
        }),
      ],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    const titleRow = await screen.findByTestId("display-reveal-title");
    const artistRow = await screen.findByTestId("display-reveal-artist");
    expect(titleRow).toHaveTextContent("???");
    expect(artistRow).toHaveTextContent("???");
  });

  it("reveals the song title once the title token is claimed", async () => {
    setSongFetch({
      id: "song-1",
      title: "Careless Whisper",
      artist: "George Michael",
      youtube_id: "izGwDsrQ1eQ",
    });
    setHydrate({
      game: makeActiveGame({ status: "playing", current_round_id: "round-1" }),
      teams: [makeTeam({ id: "t1", name: "Alpha" })],
      rounds: [
        makeRound({
          id: "round-1",
          song_id: "song-1",
          title_claimed_by: "t1",
          artist_claimed_by: null,
        }),
      ],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    await waitFor(() =>
      expect(screen.getByTestId("display-reveal-title")).toHaveTextContent("Careless Whisper"),
    );
    expect(screen.getByTestId("display-reveal-artist")).toHaveTextContent("???");
  });

  it("retries a failed song-metadata fetch so the reveal recovers within the round", async () => {
    // F-P1-7: a transient failure on the per-round songs fetch used to blank
    // the reveal for the whole round because the effect never re-ran. The
    // bounded backoff retry must recover it without any state change.
    vi.useFakeTimers();
    try {
      setSongFetch({
        id: "song-1",
        title: "Careless Whisper",
        artist: "George Michael",
        youtube_id: "izGwDsrQ1eQ",
      });
      setSongFetchFailures(1);
      setHydrate({
        game: makeActiveGame({ status: "playing", current_round_id: "round-1" }),
        teams: [makeTeam({ id: "t1", name: "Alpha" })],
        rounds: [
          makeRound({
            id: "round-1",
            song_id: "song-1",
            title_claimed_by: "t1",
            artist_claimed_by: null,
          }),
        ],
      });
      renderAt("/display/ABCDEF");
      await act(async () => {
        await fireSubscribed();
      });
      // The first attempt failed, so the claimed title still hides behind ???.
      expect(screen.getByTestId("display-reveal-title")).toHaveTextContent("???");
      // The first backoff retry (500ms) lands and fills the reveal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(screen.getByTestId("display-reveal-title")).toHaveTextContent("Careless Whisper");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reveals the film name (artist), not the song title, on a soundtrack round", async () => {
    setSongFetch({
      id: "song-1",
      title: "He's a Pirate",
      artist: "Pirates of the Caribbean",
      youtube_id: "izGwDsrQ1eQ",
      is_soundtrack: true,
    });
    setHydrate({
      game: makeActiveGame({ status: "playing", current_round_id: "round-1" }),
      teams: [makeTeam({ id: "t1", name: "Alpha" })],
      rounds: [
        makeRound({
          id: "round-1",
          song_id: "song-1",
          title_claimed_by: "t1",
          artist_claimed_by: "t1",
        }),
      ],
    });
    renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    // The single 🎬 reveal row shows the film name (artist); there is no
    // separate artist row, and the song title is never shown on the display.
    await waitFor(() =>
      expect(screen.getByTestId("display-reveal-title")).toHaveTextContent(
        "Pirates of the Caribbean",
      ),
    );
    expect(screen.queryByTestId("display-reveal-artist")).not.toBeInTheDocument();
    expect(screen.queryByText("He's a Pirate")).not.toBeInTheDocument();
  });
});

describe("DisplayPage scoreboard layout", () => {
  function makeTeams(specs: Array<{ name: string; score: number }>) {
    return specs.map((s, i) =>
      makeTeam({
        id: `t${i + 1}`,
        name: s.name,
        score: s.score,
        joined_at: `2026-05-05T12:00:${String(i).padStart(2, "0")}.000Z`,
      }),
    );
  }

  async function renderBoard(teams: ReturnType<typeof makeTeams>) {
    setHydrate({
      game: makeActiveGame({ status: "playing", round_number: 1 }),
      teams,
      rounds: [],
    });
    const utils = renderAt("/display/ABCDEF");
    await act(async () => {
      await fireSubscribed();
    });
    return utils;
  }

  it("keeps a small board in one normal-density column", async () => {
    const { container } = await renderBoard(
      makeTeams([
        { name: "Aa", score: 30 },
        { name: "Bb", score: 20 },
        { name: "Cc", score: 0 },
      ]),
    );
    expect(container.querySelector("main")).toHaveAttribute("data-density", "normal");
    expect((container.querySelector("ol") as HTMLElement).style.getPropertyValue("--rows")).toBe(
      "3",
    );
  });

  it("splits into two compact columns around a dozen teams", async () => {
    const { container } = await renderBoard(
      makeTeams(Array.from({ length: 12 }, (_, i) => ({ name: `T${i + 1}`, score: 100 - i }))),
    );
    // 12 teams -> two columns -> six rows per column -> "compact".
    expect(container.querySelector("main")).toHaveAttribute("data-density", "compact");
    expect((container.querySelector("ol") as HTMLElement).style.getPropertyValue("--rows")).toBe(
      "6",
    );
  });

  it("tightens to a dense two-column layout at 18 teams", async () => {
    const { container } = await renderBoard(
      makeTeams(Array.from({ length: 18 }, (_, i) => ({ name: `T${i + 1}`, score: 100 - i }))),
    );
    // 18 teams -> two columns -> nine rows per column -> "dense".
    expect(container.querySelector("main")).toHaveAttribute("data-density", "dense");
    expect((container.querySelector("ol") as HTMLElement).style.getPropertyValue("--rows")).toBe(
      "9",
    );
  });

  it("orders teams by score so the podium is the top three scorers", async () => {
    const { container } = await renderBoard(
      makeTeams([
        { name: "Low", score: 5 },
        { name: "High", score: 40 },
        { name: "Mid", score: 20 },
        { name: "Zero", score: 0 },
      ]),
    );
    const names = [...container.querySelectorAll("li[data-team-id] span:first-child + span")].map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["High", "Mid", "Low", "Zero"]);
  });
});
