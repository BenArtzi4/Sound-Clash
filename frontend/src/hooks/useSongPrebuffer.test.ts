import { describe, expect, it } from "vitest";
import { failedVideoContext } from "./useSongPrebuffer";

const live = { id: "song-1", title: "First", artist: "A", youtube_id: "vid1aaaaaaa" };
const next = { id: "song-2", title: "Second", artist: "B", youtube_id: "vid2bbbbbbb" };

describe("failedVideoContext", () => {
  it("names the candidate whose video failed, whatever its position", () => {
    expect(failedVideoContext("ABCDEF", 150, "vid2bbbbbbb", [live, next])).toEqual({
      code: "150",
      game_code: "ABCDEF",
      youtube_id: "vid2bbbbbbb",
      url: "https://www.youtube.com/watch?v=vid2bbbbbbb",
      song_id: "song-2",
      title: "Second",
      artist: "B",
    });
  });

  it("falls back to the most likely song when the player reported no id", () => {
    const context = failedVideoContext("ABCDEF", 2, null, [null, live]);
    expect(context.youtube_id).toBe("vid1aaaaaaa");
    expect(context.title).toBe("First");
  });

  it("keeps the id and URL but omits song fields for an unknown video", () => {
    expect(failedVideoContext("ABCDEF", 100, "otherVIDEO1", [live, next])).toEqual({
      code: "100",
      game_code: "ABCDEF",
      youtube_id: "otherVIDEO1",
      url: "https://www.youtube.com/watch?v=otherVIDEO1",
    });
  });

  it("reports just the code when nothing is known", () => {
    expect(failedVideoContext("ABCDEF", 5, null, [null, null])).toEqual({
      code: "5",
      game_code: "ABCDEF",
    });
  });
});
