import { describe, expect, it } from "vitest";
import { seo } from "../lib/routeHead";
import { HOME_ABOUT, HOME_FAQ } from "./homeContent";
import { LANDING_CONTENT, landingFor, landingPaths, type LandingContent } from "./landingContent";

// Everything the content pages say, as plain strings.
function allText(page: LandingContent): string[] {
  return [
    page.eyebrow,
    page.h1,
    page.lede,
    page.closing,
    ...page.sections.flatMap((s) => [
      s.heading,
      ...(s.paragraphs ?? []),
      ...(s.steps ?? []),
      ...(s.bullets ?? []),
    ]),
    ...page.faq.flatMap((f) => [f.question, f.answer]),
  ];
}

const words = (texts: string[]) => texts.join(" ").split(/\s+/).filter(Boolean).length;

describe("landing page content", () => {
  it("has exactly one content entry per pages.json landing page", () => {
    const content = LANDING_CONTENT.map((p) => p.path).sort();
    expect(content).toEqual([...landingPaths()].sort());
    expect(new Set(content).size).toBe(content.length);
  });

  it("finds a page by path and refuses an unknown one", () => {
    expect(landingFor("/hitster-alternative").path).toBe("/hitster-alternative");
    expect(() => landingFor("/nope")).toThrow(/No landing content/);
  });

  it.each(LANDING_CONTENT.map((p) => [p.path, p] as const))(
    "%s is a full page, not a stub",
    (_path, page) => {
      expect(page.h1.length).toBeLessThanOrEqual(70);
      expect(page.sections.length).toBeGreaterThanOrEqual(3);
      expect(page.faq.length).toBeGreaterThanOrEqual(4);
      expect(words(allText(page))).toBeGreaterThanOrEqual(500);
      for (const { question, answer } of page.faq) {
        expect(question.endsWith("?")).toBe(true);
        expect(answer.length).toBeLessThanOrEqual(320);
      }
      for (const section of page.sections) {
        const parts =
          (section.paragraphs?.length ?? 0) +
          (section.steps?.length ?? 0) +
          (section.bullets?.length ?? 0);
        expect(parts, section.heading).toBeGreaterThan(0);
      }
    },
  );

  it("never repeats a section heading or FAQ question across pages", () => {
    const headings = LANDING_CONTENT.flatMap((p) => p.sections.map((s) => s.heading));
    const questions = LANDING_CONTENT.flatMap((p) => p.faq.map((f) => f.question));
    expect(new Set(headings).size).toBe(headings.length);
    expect(new Set(questions).size).toBe(questions.length);
  });

  // House rules for every page's words (docs/seo.md §4).
  it.each([
    ...LANDING_CONTENT.map((p) => [p.path, allText(p)] as const),
    [
      "Home",
      [
        HOME_ABOUT.heading,
        HOME_ABOUT.intro,
        HOME_ABOUT.catalog,
        ...HOME_ABOUT.steps,
        ...HOME_FAQ.flatMap((f) => [f.question, f.answer]),
      ],
    ] as const,
  ])("%s keeps to the copy rules", (_page, texts) => {
    const text = texts.join("\n");
    // A trademark we must not lean on, claims we cannot back, and the
    // em dash the house style leaves out.
    expect(text).not.toMatch(/name that tune/i);
    expect(text).not.toMatch(/\bthe best\b|#1|number one|award-winning|trusted by|top-rated/i);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/https?:\/\//);
    // The numbers the game actually uses (docs/game-rules.md).
    for (const points of text.match(/[+-]\d+(?= points| for|\b)/g) ?? []) {
      expect(["+10", "+5", "-3", "+4", "+15"]).toContain(points);
    }
  });

  it("names the competitor pages' products only with a not-affiliated line", () => {
    for (const [path, brand] of [
      ["/kahoot-music-quiz-alternative", "Kahoot!"],
      ["/hitster-alternative", "Hitster"],
    ] as const) {
      const text = allText(landingFor(path)).join(" ");
      expect(text).toContain(`not affiliated with ${brand}`);
    }
  });

  it("titles every landing page with its primary phrase and the brand", () => {
    for (const page of seo.pages.filter((p) => p.landing)) {
      expect(page.title.endsWith("| Sound Clash")).toBe(true);
      expect(page.title.length).toBeLessThanOrEqual(62);
    }
  });
});
