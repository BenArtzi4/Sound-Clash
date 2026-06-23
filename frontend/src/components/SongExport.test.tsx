import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", async () => {
  const mod = await import("../test/supabaseMock");
  return { supabase: mod.supabaseMock };
});

import { SongExport } from "./SongExport";
import { YT_PLAYLIST_MAX } from "../lib/exportSongs";
import {
  makeActiveGame,
  makeRound,
  makeTeam,
  resetSupabaseMock,
  setSongFetch,
} from "../test/supabaseMock";

const game = makeActiveGame({ status: "ended", game_code: "ABCDEF" });

beforeEach(() => {
  resetSupabaseMock();
  // jsdom doesn't implement object URLs; stub them so the download path runs.
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SongExport", () => {
  it("resolves the played songs and enables both export buttons", async () => {
    setSongFetch({ id: "s1", title: "One", artist: "A", youtube_id: "aaaaaaaaaaa" });
    setSongFetch({ id: "s2", title: "Two", artist: "B", youtube_id: "bbbbbbbbbbb" });
    const rounds = [
      makeRound({ id: "r1", round_number: 1, song_id: "s1" }),
      makeRound({ id: "r2", round_number: 2, song_id: "s2" }),
    ];
    render(<SongExport game={game} rounds={rounds} teams={[makeTeam()]} />);

    await waitFor(() => expect(screen.getByTestId("export-download")).toBeEnabled());
    expect(screen.getByTestId("export-playlist")).toBeEnabled();
  });

  it("opens a YouTube playlist built from the played video ids, in round order", async () => {
    setSongFetch({ id: "s1", title: "One", artist: "A", youtube_id: "aaaaaaaaaaa" });
    setSongFetch({ id: "s2", title: "Two", artist: "B", youtube_id: "bbbbbbbbbbb" });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const rounds = [
      // Out of order on purpose: the component must sort by round_number.
      makeRound({ id: "r2", round_number: 2, song_id: "s2" }),
      makeRound({ id: "r1", round_number: 1, song_id: "s1" }),
    ];
    render(<SongExport game={game} rounds={rounds} teams={[makeTeam()]} />);

    const playlist = screen.getByTestId("export-playlist");
    await waitFor(() => expect(playlist).toBeEnabled());
    fireEvent.click(playlist);

    expect(openSpy).toHaveBeenCalledTimes(1);
    const url = String(openSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("watch_videos?video_ids=aaaaaaaaaaa,bbbbbbbbbbb");
  });

  it("downloads an HTML blob named for the game", async () => {
    setSongFetch({ id: "s1", title: "One", artist: "A", youtube_id: "aaaaaaaaaaa" });
    let downloadName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });
    const rounds = [makeRound({ id: "r1", round_number: 1, song_id: "s1" })];
    render(<SongExport game={game} rounds={rounds} teams={[makeTeam()]} />);

    const download = screen.getByTestId("export-download");
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadName).toBe("sound-clash-ABCDEF-songs.html");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("shows a no-songs state and disables the buttons when no round has a song", () => {
    const rounds = [makeRound({ id: "r1", round_number: 1, song_id: null })];
    render(<SongExport game={game} rounds={rounds} teams={[makeTeam()]} />);

    expect(screen.getByText(/no songs to export/i)).toBeInTheDocument();
    expect(screen.getByTestId("export-download")).toBeDisabled();
    expect(screen.getByTestId("export-playlist")).toBeDisabled();
  });

  it("notes truncation when more songs played than the YouTube cap", async () => {
    const rounds = [];
    for (let i = 0; i < YT_PLAYLIST_MAX + 5; i++) {
      const id = `s${i}`;
      setSongFetch({ id, title: `T${i}`, artist: "A", youtube_id: `v${i}`.padEnd(11, "x") });
      rounds.push(makeRound({ id: `r${i}`, round_number: i + 1, song_id: id }));
    }
    render(<SongExport game={game} rounds={rounds} teams={[makeTeam()]} />);

    await screen.findByText(/opens the first 50 songs/i);
  });
});
