import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});
vi.mock("../lib/exportFonts", () => ({
  loadExportFonts: vi.fn(async () => ({ anton: "data:font/woff2;base64,QU5UT04=" })),
}));

import { Setlist } from "./Setlist";
import { YT_PLAYLIST_MAX } from "../lib/exportSongs";
import {
  getSongBatchAttempts,
  makeActiveGame,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setSongBatchFailures,
  setSongFetch,
} from "../test/supabaseMock";

// Started 5 Sep 2026 at noon local time, so the file date is the same in any zone.
const game = makeActiveGame({
  status: "ended",
  started_at: new Date(2026, 8, 5, 12).toISOString(),
});
const alpha = makeTeam({ id: "t-a", name: "Alpha", score: 25 });
const bravo = makeTeam({ id: "t-b", name: "Bravo", score: 10 });

function defineGlobal(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
}

function seedTwoSongs() {
  setSongFetch({
    id: "s1",
    title: "One",
    artist: "A",
    youtube_id: "aaaaaaaaaaa",
    release_year: 1999,
  });
  setSongFetch({ id: "s2", title: "Two", artist: "B", youtube_id: "bbbbbbbbbbb" });
  return [
    // Out of order on purpose: the setlist must sort by round_number.
    makeRound({ id: "r2", round_number: 2, song_id: "s2", artist_claimed_by: "t-b" }),
    makeRound({
      id: "r1",
      round_number: 1,
      song_id: "s1",
      title_claimed_by: "t-a",
      artist_claimed_by: "t-a",
    }),
  ];
}

beforeEach(() => {
  resetSupabaseMock();
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(window, "matchMedia");
});

describe("Setlist", () => {
  it("lists the played songs in round order with year and who got them", async () => {
    render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

    const rows = await screen.findAllByTestId("setlist-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("One")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("1999");
    expect(rows[0]).toHaveTextContent("Got it: Alpha");
    expect(rows[1]).toHaveTextContent("Artist: Bravo");
    expect(screen.getByText("2 songs")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("link", { name: /play one on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    );
    expect(screen.getByTestId("export-download")).toBeEnabled();
    expect(screen.getByTestId("export-share")).toBeEnabled();
  });

  it("marks soundtrack rounds, hides a repeated artist, and says when nobody got it", async () => {
    setSongFetch({
      id: "s1",
      title: "Sherlock",
      artist: "Sherlock",
      youtube_id: "ccccccccccc",
      is_soundtrack: true,
    });
    render(
      <Setlist
        game={game}
        rounds={[makeRound({ id: "r1", round_number: 1, song_id: "s1" })]}
        teams={[alpha]}
      />,
    );

    const [row] = await screen.findAllByTestId("setlist-row");
    expect(row).toHaveTextContent("Soundtrack");
    expect(row).toHaveTextContent("Nobody got it");
    expect(within(row!).getAllByText("Sherlock")).toHaveLength(1);
  });

  it("credits a team that has since left the game", async () => {
    setSongFetch({ id: "s1", title: "One", artist: "A", youtube_id: "aaaaaaaaaaa" });
    render(
      <Setlist
        game={game}
        rounds={[makeRound({ id: "r1", round_number: 1, song_id: "s1", title_claimed_by: "gone" })]}
        teams={[alpha]}
      />,
    );
    expect(await screen.findByText(/a team that left/i)).toBeInTheDocument();
  });

  it("links one YouTube playlist of the played ids in round order", async () => {
    render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

    const link = await screen.findByRole("link", { name: /play all on youtube/i });
    expect(link).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch_videos?video_ids=aaaaaaaaaaa,bbbbbbbbbbb",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("data-testid", "export-playlist");
  });

  it("splits a long game into playlist parts so no song is dropped", async () => {
    const rounds = [];
    for (let i = 0; i < YT_PLAYLIST_MAX + 5; i++) {
      setSongFetch({ id: `s${i}`, title: `T${i}`, artist: "A", youtube_id: `v${i}` });
      rounds.push(makeRound({ id: `r${i}`, round_number: i + 1, song_id: `s${i}` }));
    }
    render(<Setlist game={game} rounds={rounds} teams={[alpha]} />);

    const first = await screen.findByRole("link", { name: /play songs 1–50/i });
    const second = screen.getByRole("link", { name: /play songs 51–55/i });
    expect(first).toHaveAttribute("data-testid", "export-playlist");
    expect(second).toHaveAttribute("data-testid", "export-playlist-2");
    expect(second.getAttribute("href")).toBe(
      "https://www.youtube.com/watch_videos?video_ids=v50,v51,v52,v53,v54",
    );
  });

  it("shows the first five songs and expands to all of them", async () => {
    const rounds = [];
    for (let i = 0; i < 8; i++) {
      setSongFetch({ id: `s${i}`, title: `Song ${i}`, artist: "A", youtube_id: `v${i}` });
      rounds.push(makeRound({ id: `r${i}`, round_number: i + 1, song_id: `s${i}` }));
    }
    render(<Setlist game={game} rounds={rounds} teams={[alpha]} />);

    expect(await screen.findAllByTestId("setlist-row")).toHaveLength(5);
    const toggle = screen.getByTestId("setlist-toggle");
    expect(toggle).toHaveTextContent("Show all 8 songs");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("setlist-row")).toHaveLength(8);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getAllByTestId("setlist-row")).toHaveLength(5);
  });

  it("copies the plain 'Artist - Title' list on a laptop", async () => {
    const writeText = vi.fn(async () => {});
    defineGlobal(navigator, "clipboard", { writeText });
    render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

    const button = await screen.findByRole("button", { name: /copy list/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await screen.findByText("Copied");
    expect(writeText).toHaveBeenCalledWith("A - One\nB - Two");
  });

  it("says so when the copy fails", async () => {
    defineGlobal(navigator, "clipboard", {
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

    const button = await screen.findByRole("button", { name: /copy list/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/couldn't copy the list/i)).toBeInTheDocument();
  });

  describe("on a phone", () => {
    beforeEach(() => {
      defineGlobal(
        window,
        "matchMedia",
        vi.fn(() => ({ matches: true })),
      );
    });

    it("opens the share sheet with the list", async () => {
      const share = vi.fn(async () => {});
      defineGlobal(navigator, "share", share);
      render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

      const button = await screen.findByRole("button", { name: /share list/i });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);

      await waitFor(() =>
        expect(share).toHaveBeenCalledWith({
          title: "Sound Clash setlist · 5 Sep 2026",
          text: "A - One\nB - Two",
        }),
      );
    });

    it("does nothing when the sheet is dismissed and copies when sharing fails", async () => {
      const writeText = vi.fn(async () => {});
      defineGlobal(navigator, "clipboard", { writeText });
      const share = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("closed", "AbortError"))
        .mockRejectedValueOnce(new Error("no share target"));
      defineGlobal(navigator, "share", share);
      render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

      const button = await screen.findByRole("button", { name: /share list/i });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      expect(writeText).not.toHaveBeenCalled();

      fireEvent.click(button);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("A - One\nB - Two"));
    });
  });

  it("saves a themed keepsake file named for the game date", async () => {
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    const timeouts: { cb: () => void; ms: number | undefined }[] = [];
    render(<Setlist game={game} rounds={seedTwoSongs()} teams={[bravo, alpha]} />);

    const button = screen.getByTestId("export-download");
    await waitFor(() => expect(button).toBeEnabled());
    // Let the (mocked) font preload land before saving.
    await act(async () => {});
    const realSetTimeout = window.setTimeout;
    vi.spyOn(window, "setTimeout").mockImplementation(((cb: () => void, ms?: number) => {
      timeouts.push({ cb, ms });
      return 0;
    }) as unknown as typeof window.setTimeout);
    fireEvent.click(button);
    window.setTimeout = realSetTimeout;

    expect(downloadName).toBe("sound-clash-setlist-2026-09-05.html");
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    const html = await blob.text();
    expect(html).toContain("<title>Sound Clash · 5 Sep 2026</title>");
    expect(html).toContain("data:font/woff2;base64,QU5UT04=");
    // Highest score first, whatever order the board handed over.
    expect(html.indexOf("Alpha")).toBeLessThan(html.indexOf("Bravo"));
    // The object URL outlives the click (Safari aborts an instantly revoked one).
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const revoke = timeouts.find((t) => t.ms === 60_000);
    revoke?.cb();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("shows a no-songs state and disables the actions when no round had a song", () => {
    render(
      <Setlist
        game={game}
        rounds={[makeRound({ id: "r1", round_number: 1, song_id: null })]}
        teams={[alpha]}
      />,
    );

    expect(screen.getByText(/no songs were played/i)).toBeInTheDocument();
    expect(screen.getByTestId("export-download")).toBeDisabled();
    expect(screen.getByTestId("export-share")).toBeDisabled();
    expect(screen.getByTestId("export-playlist")).toBeDisabled();
  });

  it("offers a retry when the song lookup keeps failing, and recovers", async () => {
    setSongBatchFailures(3);
    render(<Setlist game={game} rounds={seedTwoSongs()} teams={[alpha, bravo]} />);

    expect(screen.getByText(/loading the songs/i)).toBeInTheDocument();
    const retry = await screen.findByTestId("setlist-retry", {}, { timeout: 4000 });
    expect(screen.getByText(/couldn't load the songs/i)).toBeInTheDocument();
    expect(getSongBatchAttempts()).toBe(3);
    expect(screen.getByTestId("export-download")).toBeDisabled();

    fireEvent.click(retry);
    expect(await screen.findAllByTestId("setlist-row")).toHaveLength(2);
    expect(getSongBatchAttempts()).toBe(4);
  });

  it("does not refetch when the channel hands over a fresh copy of the same rounds", async () => {
    const rounds = seedTwoSongs();
    const { rerender } = render(<Setlist game={game} rounds={rounds} teams={[alpha, bravo]} />);
    await screen.findAllByTestId("setlist-row");
    rerender(<Setlist game={game} rounds={rounds.map((r) => ({ ...r }))} teams={[alpha, bravo]} />);
    await act(async () => {});
    expect(getSongBatchAttempts()).toBe(1);
  });
});
