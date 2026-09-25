import { describe, expect, it } from "vitest";
import {
  buildPlaylistParts,
  buildSongsHtml,
  buildSongsText,
  creditFor,
  denseRanks,
  exportFileName,
  formatGameDate,
  showArtist,
  YT_PLAYLIST_MAX,
  type ExportMeta,
  type ExportSong,
} from "./exportSongs";

function song(overrides: Partial<ExportSong> = {}): ExportSong {
  return {
    round_number: 1,
    title: "First",
    artist: "One",
    youtube_id: "aaaaaaaaaaa",
    release_year: null,
    is_soundtrack: false,
    title_by: null,
    artist_by: null,
    ...overrides,
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id${i}`);

describe("buildPlaylistParts", () => {
  it("returns nothing for no songs", () => {
    expect(buildPlaylistParts([])).toEqual([]);
  });

  it("builds one watch_videos link for up to YT_PLAYLIST_MAX ids", () => {
    const parts = buildPlaylistParts(["a", "b", "c"]);
    expect(parts).toEqual([
      { url: "https://www.youtube.com/watch_videos?video_ids=a,b,c", from: 1, to: 3 },
    ]);
    expect(buildPlaylistParts(ids(YT_PLAYLIST_MAX))).toHaveLength(1);
  });

  it("splits into parts of YT_PLAYLIST_MAX so no song is dropped", () => {
    const parts = buildPlaylistParts(ids(YT_PLAYLIST_MAX + 1));
    expect(parts.map((p) => [p.from, p.to])).toEqual([
      [1, 50],
      [51, 51],
    ]);
    expect(parts[1]?.url).toBe("https://www.youtube.com/watch_videos?video_ids=id50");

    const hundred = buildPlaylistParts(ids(100));
    expect(hundred.map((p) => [p.from, p.to])).toEqual([
      [1, 50],
      [51, 100],
    ]);
    const all = hundred.flatMap((p) => (p.url.split("video_ids=")[1] ?? "").split(","));
    expect(all).toEqual(ids(100));
  });

  it("URL-encodes each id", () => {
    expect(buildPlaylistParts(["a&b"])[0]?.url).toBe(
      "https://www.youtube.com/watch_videos?video_ids=a%26b",
    );
  });
});

describe("showArtist", () => {
  it("hides an empty artist or one that just repeats the title", () => {
    expect(showArtist(song({ artist: "" }))).toBe(false);
    expect(showArtist(song({ title: "Sherlock", artist: "Sherlock" }))).toBe(false);
    expect(showArtist(song({ title: "Sherlock ", artist: "sherlock" }))).toBe(false);
    expect(showArtist(song({ title: "Baby", artist: "Justin Bieber" }))).toBe(true);
  });
});

describe("creditFor", () => {
  it("names one team that got both parts", () => {
    expect(creditFor(song({ title_by: "Alpha", artist_by: "Alpha" }))).toBe("Got it: Alpha");
  });

  it("names each part's team when they differ or only one part was claimed", () => {
    expect(creditFor(song({ title_by: "Alpha", artist_by: "Bravo" }))).toBe(
      "Song: Alpha · Artist: Bravo",
    );
    expect(creditFor(song({ title_by: "Alpha" }))).toBe("Song: Alpha");
    expect(creditFor(song({ artist_by: "Bravo" }))).toBe("Artist: Bravo");
  });

  it("says so when nobody got it", () => {
    expect(creditFor(song())).toBe("Nobody got it");
  });
});

describe("buildSongsText", () => {
  it("writes one 'Artist - Title' line per song, in order, for playlist converters", () => {
    const text = buildSongsText([
      song({ title: "Baby", artist: "Justin Bieber" }),
      song({ round_number: 2, title: "הזמן שלך", artist: "היהודים" }),
    ]);
    expect(text).toBe("Justin Bieber - Baby\nהיהודים - הזמן שלך");
  });

  it("writes the title alone when there is no artist to show", () => {
    expect(buildSongsText([song({ title: "Sherlock", artist: "Sherlock" })])).toBe("Sherlock");
  });

  it("is empty for no songs", () => {
    expect(buildSongsText([])).toBe("");
  });
});

describe("denseRanks", () => {
  it("shares a rank between tied teams and keeps the given order", () => {
    expect(
      denseRanks([
        { name: "A", score: 20 },
        { name: "B", score: 20 },
        { name: "C", score: 5 },
      ]),
    ).toEqual([
      { name: "A", score: 20, rank: 1 },
      { name: "B", score: 20, rank: 1 },
      { name: "C", score: 5, rank: 2 },
    ]);
  });
});

describe("formatGameDate / exportFileName", () => {
  it("formats the game date the same way whatever the browser locale", () => {
    expect(formatGameDate("2026-09-25T17:51:01.000Z")).toMatch(/^2[56] Sep 2026$/);
  });

  it("names the file after the local game date", () => {
    expect(exportFileName(new Date(2026, 8, 5, 21, 0))).toBe("sound-clash-setlist-2026-09-05.html");
  });
});

describe("buildSongsHtml", () => {
  const meta: ExportMeta = {
    dateLabel: "25 Sep 2026",
    teams: [
      { name: "Alice", score: 20 },
      { name: "Bob", score: 20 },
      { name: "Carol", score: 3 },
    ],
  };
  const songs: ExportSong[] = [
    song({ round_number: 1, title: "First", artist: "One", release_year: 1999, title_by: "Alice" }),
    song({ round_number: 2, title: "Second", artist: "Two", youtube_id: "bbbbbbbbbbb" }),
  ];

  it("is a complete dark-themed document with the date, teams and songs", () => {
    const html = buildSongsHtml(meta, songs);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Sound Clash · 25 Sep 2026</title>");
    expect(html).toContain("#14120e");
    expect(html).toContain("#ff7a00");
    expect(html).toContain("25 Sep 2026");
    expect(html).toContain("Alice");
    expect(html).toContain("First");
    expect(html).toContain("1999");
    expect(html).toContain("Song: <bdi>Alice</bdi>");
    expect(html).toContain("Nobody got it");
    expect(html).toContain('href="https://www.youtube.com/watch?v=aaaaaaaaaaa"');
    expect(html).toContain('href="https://www.youtube.com/watch?v=bbbbbbbbbbb"');
    expect(html).toContain(
      'href="https://www.youtube.com/watch_videos?video_ids=aaaaaaaaaaa,bbbbbbbbbbb"',
    );
    expect(html).toContain('href="https://www.soundclash.org/"');
  });

  it("calls tied winners winners", () => {
    expect(buildSongsHtml(meta, songs)).toContain("Winners");
    const solo = { ...meta, teams: [{ name: "Solo", score: 9 }] };
    const html = buildSongsHtml(solo, songs);
    expect(html).toContain("Winner");
    expect(html).not.toContain("Winners");
  });

  it("gives every free-text run its own direction so Hebrew reads right", () => {
    const html = buildSongsHtml({ ...meta, teams: [{ name: "צוות אלפא", score: 1 }] }, [
      song({ title: "הזמן שלך", artist: "היהודים", title_by: "צוות אלפא" }),
    ]);
    expect(html).toContain("<bdi>צוות אלפא</bdi>");
    expect(html).toContain('<span class="song-title" dir="auto">הזמן שלך</span>');
    expect(html).toContain('<span class="song-artist" dir="auto">היהודים</span>');
  });

  it("links every part when more songs played than one YouTube list holds", () => {
    const many = Array.from({ length: YT_PLAYLIST_MAX + 3 }, (_, i) =>
      song({ round_number: i + 1, youtube_id: `v${i}` }),
    );
    const html = buildSongsHtml(meta, many);
    expect(html).toContain("Play songs 1–50");
    expect(html).toContain("Play songs 51–53");
  });

  it("embeds the display fonts when given and falls back to system fonts otherwise", () => {
    const withFonts = buildSongsHtml(meta, songs, {
      anton: "data:font/woff2;base64,QU5UT04=",
      secularOne: "data:font/woff2;base64,U0VDVUxBUg==",
    });
    expect(withFonts).toContain('src: url("data:font/woff2;base64,QU5UT04=")');
    expect(withFonts).toContain('src: url("data:font/woff2;base64,U0VDVUxBUg==")');
    expect(buildSongsHtml(meta, songs)).not.toContain("@font-face");
  });

  it("marks soundtrack rounds and hides an artist that repeats the title", () => {
    const html = buildSongsHtml(meta, [
      song({ title: "Sherlock", artist: "Sherlock", is_soundtrack: true }),
    ]);
    expect(html).toContain("Soundtrack");
    expect(html).not.toContain('<span class="song-artist" dir="auto">Sherlock</span>');
  });

  it("HTML-escapes titles, artists and team names", () => {
    const html = buildSongsHtml(
      { dateLabel: "now", teams: [{ name: "<script>alert(1)</script>", score: 0 }] },
      [
        song({
          title: 'Rock & "Roll" <b>',
          artist: "A&B",
          title_by: "<img src=x onerror=alert(1)>",
        }),
      ],
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Rock &amp; &quot;Roll&quot; &lt;b&gt;");
    expect(html).toContain("A&amp;B");
  });

  it("renders a graceful document when there are no songs or teams", () => {
    const html = buildSongsHtml({ dateLabel: "now", teams: [] }, []);
    expect(html).toContain("No songs were played.");
    expect(html).toContain("No teams played.");
    expect(html).not.toContain("watch_videos");
  });
});
