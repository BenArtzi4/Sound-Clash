import { describe, expect, it } from "vitest";
import {
  buildSongsHtml,
  buildYouTubePlaylistUrl,
  isPlaylistTruncated,
  YT_PLAYLIST_MAX,
  type ExportMeta,
  type ExportSong,
} from "./exportSongs";

describe("buildYouTubePlaylistUrl", () => {
  it("joins ids into the watch_videos endpoint", () => {
    expect(buildYouTubePlaylistUrl(["a", "b", "c"])).toBe(
      "https://www.youtube.com/watch_videos?video_ids=a,b,c",
    );
  });

  it("handles a single id", () => {
    expect(buildYouTubePlaylistUrl(["only"])).toBe(
      "https://www.youtube.com/watch_videos?video_ids=only",
    );
  });

  it("truncates to YT_PLAYLIST_MAX ids", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
    const after = buildYouTubePlaylistUrl(ids).split("video_ids=")[1] ?? "";
    const list = after.split(",");
    expect(list).toHaveLength(YT_PLAYLIST_MAX);
    expect(list[0]).toBe("id0");
    expect(list[YT_PLAYLIST_MAX - 1]).toBe(`id${YT_PLAYLIST_MAX - 1}`);
  });
});

describe("isPlaylistTruncated", () => {
  it("is false at or below the cap and true above it", () => {
    expect(isPlaylistTruncated(YT_PLAYLIST_MAX - 1)).toBe(false);
    expect(isPlaylistTruncated(YT_PLAYLIST_MAX)).toBe(false);
    expect(isPlaylistTruncated(YT_PLAYLIST_MAX + 1)).toBe(true);
  });
});

describe("buildSongsHtml", () => {
  const meta: ExportMeta = {
    gameCode: "ABCDEF",
    dateLabel: "May 5, 2026, 12:00 PM",
    teams: [
      { name: "Alice", score: 7 },
      { name: "Bob", score: 3 },
    ],
  };
  const songs: ExportSong[] = [
    { round_number: 1, title: "First", artist: "One", youtube_id: "aaaaaaaaaaa" },
    { round_number: 2, title: "Second", artist: "Two", youtube_id: "bbbbbbbbbbb" },
  ];

  it("includes the game code, date, teams, and per-song watch links", () => {
    const html = buildSongsHtml(meta, songs);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("ABCDEF");
    expect(html).toContain("May 5, 2026, 12:00 PM");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("First");
    expect(html).toContain("https://www.youtube.com/watch?v=aaaaaaaaaaa");
    expect(html).toContain("https://www.youtube.com/watch?v=bbbbbbbbbbb");
  });

  it("HTML-escapes titles, artists, and team names", () => {
    const evilSongs: ExportSong[] = [
      { round_number: 1, title: 'Rock & "Roll" <b>', artist: "A&B", youtube_id: "ccccccccccc" },
    ];
    const evilMeta: ExportMeta = {
      gameCode: "ABCDEF",
      dateLabel: "now",
      teams: [{ name: "<script>alert(1)</script>", score: 0 }],
    };
    const html = buildSongsHtml(evilMeta, evilSongs);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Rock &amp; &quot;Roll&quot; &lt;b&gt;");
    expect(html).toContain("A&amp;B");
  });

  it("renders a graceful document when there are no songs or teams", () => {
    const html = buildSongsHtml({ gameCode: "ABCDEF", dateLabel: "now", teams: [] }, []);
    expect(html).toContain("No songs played.");
    expect(html).toContain("No teams played.");
  });

  it("keeps both entries when a song repeats across rounds", () => {
    const dup: ExportSong[] = [
      { round_number: 1, title: "Echo", artist: "X", youtube_id: "ddddddddddd" },
      { round_number: 2, title: "Echo", artist: "X", youtube_id: "ddddddddddd" },
    ];
    const matches = buildSongsHtml(meta, dup).match(/watch\?v=ddddddddddd/g);
    expect(matches).toHaveLength(2);
  });
});
