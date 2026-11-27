import { describe, expect, it } from "vitest";
import { countSongLines, detectLinks } from "./setlistText";

// countSongLines must give the server's lines_total (POST /setlists/check,
// backend/app/services/setlist_text.py parse_setlist_text) for the same text.
describe("countSongLines", () => {
  it("drops empty lines, comments and links", () => {
    expect(countSongLines("Queen - A\n\n# note\nhttps://x.y/z\nFrozen")).toBe(2);
  });

  it("counts nothing in an empty or blank text", () => {
    expect(countSongLines("")).toBe(0);
    expect(countSongLines("  \n\t\n")).toBe(0);
  });

  it("treats only '#' then a space, another '#' or nothing as a comment", () => {
    expect(countSongLines("#1 Crush - X")).toBe(1);
    expect(countSongLines("#Word")).toBe(1);
    expect(countSongLines("  # indented note\n## heading\n#\nSong")).toBe(1);
  });

  it("drops a line with no letter or digit", () => {
    expect(countSongLines("***")).toBe(0);
    expect(countSongLines("--- \n Queen - A")).toBe(1);
  });

  it("keeps a numbered or bulleted line, or one with a duration", () => {
    expect(countSongLines("1. Queen - Bohemian Rhapsody")).toBe(1);
    expect(countSongLines("\u2022 Queen - A\n- ABBA - B\n3) Song (3:51)")).toBe(3);
  });

  it("drops a line that is only numbering, a bullet or a duration around nothing", () => {
    // The numbering and the duration are removed first, as on the server.
    expect(countSongLines("1. ***\n* \u266a 3:51")).toBe(0);
  });

  it("drops a numbered link and a spotify: URI", () => {
    expect(countSongLines("1. https://open.spotify.com/track/a\nspotify:track:abc")).toBe(0);
    expect(countSongLines("www.youtube.com/watch?v=x\nQueen - A")).toBe(1);
  });

  it("splits lines the way the server does", () => {
    expect(countSongLines("A\r\nB\rC\u2028D")).toBe(4);
  });

  it("reads U+001F as a space, as the server's Python does", () => {
    // A line of it is blank, so the header below is still the first line.
    expect(countSongLines("\u001f\nTitle,Artist\nSong A,Queen")).toBe(1);
    expect(countSongLines("#\u001fnote\nSong")).toBe(1);
  });

  it("ignores the invisible marks a paste carries", () => {
    expect(countSongLines("\u200f# note\n\ufeffQueen - A\n\u200e\u202a")).toBe(1);
  });

  it("counts the rows of a TSV export, not its header", () => {
    expect(countSongLines("Name\tArtist\nSong A\tQueen\nSong B\tABBA")).toBe(2);
  });

  it("counts the rows of a CSV export, not its header", () => {
    const csv = [
      '"Track URI","Track Name","Artist URI(s)","Artist Name(s)"',
      '"spotify:track:1","Song A","spotify:artist:1","Queen"',
      // No space in any cell: read as a plain line it would be one link.
      "spotify:track:2,Hello,spotify:artist:2,ABBA",
    ].join("\n");
    expect(countSongLines(csv)).toBe(2);
  });

  it("drops a table row whose title and artist cells are empty", () => {
    expect(countSongLines("Title,Artist,Plays\n,,12\nSong A,Queen,3")).toBe(1);
  });

  it("finds a header that starts with '#' or sits below comments", () => {
    // "#" + tab would be a comment; as a header, the row "2" with empty
    // title and artist cells is not a song.
    expect(countSongLines("#\tSong\tArtist\n1\tSong A\tQueen\n2\t\t")).toBe(1);
    expect(countSongLines("# my list\nTitle,Artist\nSong A,Queen")).toBe(1);
  });

  it("needs a title column and an artist name column for a header", () => {
    // "Artist URI" is not a name, so the first line is a song line.
    expect(countSongLines("Title,Artist URI\nSong A,spotify:artist:1")).toBe(2);
    expect(countSongLines("Title,Album\nSong A,Greatest Hits")).toBe(2);
  });
});

describe("detectLinks", () => {
  it("says spotify when every line is a Spotify link", () => {
    expect(detectLinks("https://open.spotify.com/track/a\nhttps://open.spotify.com/track/b")).toBe(
      "spotify",
    );
    expect(detectLinks("spotify:track:abc\n\n# my list\n1. https://open.spotify.com/track/b")).toBe(
      "spotify",
    );
  });

  it("says youtube when every line is a YouTube link", () => {
    expect(detectLinks("https://www.youtube.com/playlist?list=PL1")).toBe("youtube");
    expect(
      detectLinks(
        [
          "https://youtu.be/abc",
          "http://m.youtube.com/watch?v=x",
          "https://music.youtube.com/watch?v=y",
          "www.youtube.com/watch?v=z",
          "https://YouTube.com/watch?v=w",
        ].join("\n"),
      ),
    ).toBe("youtube");
  });

  it("says other for other links or a mix of sites", () => {
    expect(detectLinks("https://music.apple.com/il/playlist/x")).toBe("other");
    expect(detectLinks("https://open.spotify.com/track/a\nhttps://youtu.be/abc")).toBe("other");
  });

  it("is null when nothing is pasted", () => {
    expect(detectLinks("")).toBeNull();
    expect(detectLinks("\n  \n# only a note")).toBeNull();
  });

  it("is null when any line is a song line", () => {
    expect(detectLinks("Queen - A\nhttps://open.spotify.com/track/a")).toBeNull();
    expect(
      detectLinks(
        "Track Name,Artist Name\nGlass Harbor,Moonfish\nhttps://open.spotify.com/track/a",
      ),
    ).toBeNull();
  });

  // As the server reads the list (setlist_links_only): every line it keeps
  // that is no song line, and at least one link.
  it("reads the links of a list with no song line, as the server does", () => {
    expect(detectLinks("https://open.spotify.com/track/a\n***")).toBe("spotify");
    expect(
      detectLinks(
        "Track Name,Artist Name\nhttps://open.spotify.com/track/a\nhttps://open.spotify.com/track/b",
      ),
    ).toBe("spotify");
    expect(detectLinks("Title\tArtist\n# exported\nhttps://youtu.be/abc")).toBe("youtube");
  });

  it("is null when no line is a link", () => {
    expect(detectLinks("***\n---")).toBeNull();
    expect(detectLinks("Track Name,Artist Name")).toBeNull();
  });
});
