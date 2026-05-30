import { describe, expect, it } from "vitest";
import { deriveIsSoundtrack, SOUNDTRACK_GENRE_SLUGS } from "./soundtrack";

describe("deriveIsSoundtrack", () => {
  it("is true when a genre slug is a soundtrack slug", () => {
    expect(deriveIsSoundtrack([{ genres: { slug: "soundtracks" } }])).toBe(true);
    expect(deriveIsSoundtrack([{ genres: { slug: "israeli-soundtracks" } }])).toBe(true);
  });

  it("is true when any of several genres is a soundtrack slug", () => {
    expect(
      deriveIsSoundtrack([{ genres: { slug: "rock" } }, { genres: { slug: "soundtracks" } }]),
    ).toBe(true);
  });

  it("is false for non-soundtrack genres", () => {
    expect(deriveIsSoundtrack([{ genres: { slug: "rock" } }, { genres: { slug: "pop" } }])).toBe(
      false,
    );
  });

  it("is false for empty / null / missing genre data", () => {
    expect(deriveIsSoundtrack([])).toBe(false);
    expect(deriveIsSoundtrack(null)).toBe(false);
    expect(deriveIsSoundtrack(undefined)).toBe(false);
    expect(deriveIsSoundtrack([null])).toBe(false);
    expect(deriveIsSoundtrack([{ genres: null }])).toBe(false);
    expect(deriveIsSoundtrack([{ genres: { slug: null } }])).toBe(false);
  });

  it("exposes the two soundtrack slugs", () => {
    expect(SOUNDTRACK_GENRE_SLUGS).toEqual(["soundtracks", "israeli-soundtracks"]);
  });
});
