import { describe, expect, it } from "vitest";
import { seo } from "../lib/routeHead";
import { ARTIST_POINTS, TITLE_POINTS, WRONG_BUZZ_PENALTY } from "../lib/scoring";
import { LANDING_CONTENT } from "./landingContent";
import { llmsFullTxt, llmsTxt } from "./llms";

describe("llms.txt", () => {
  const text = llmsTxt();

  // https://llmstxt.org: an H1 with the name, then a blockquote summary, then
  // H2 sections of Markdown links.
  it("follows the llms.txt layout", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# Sound Clash");
    expect(lines[2]?.startsWith("> ")).toBe(true);
    expect(text).toContain("\n## Pages\n");
    expect(text).toContain("\n## Optional\n");
    expect(text.match(/^# /gm)).toHaveLength(1);
  });

  it("links every page in the sitemap and the three ways in", () => {
    for (const page of seo.pages.filter((p) => p.inSitemap)) {
      const url = seo.origin + page.path;
      expect(text).toContain(`](${url}): ${page.description}`);
    }
    for (const path of ["/manager/create", "/join", "/display"]) {
      expect(text).toContain(`](${seo.origin}${path})`);
    }
    expect(text).toContain(`(${seo.origin}/llms-full.txt)`);
  });

  it("quotes the scoring the game uses", () => {
    expect(text).toContain(`correct title +${TITLE_POINTS}`);
    expect(text).toContain(`correct artist +${ARTIST_POINTS}`);
    expect(text).toContain(`wrong buzz -${WRONG_BUZZ_PENALTY}`);
  });
});

describe("llms-full.txt", () => {
  const text = llmsFullTxt();

  it("carries the full text of Home and every landing page", () => {
    expect(text.startsWith("# Sound Clash: full text\n")).toBe(true);
    for (const page of LANDING_CONTENT) {
      expect(text).toContain(`## ${page.h1}`);
      expect(text).toContain(page.lede);
      for (const { question, answer } of page.faq) {
        expect(text).toContain(`### ${question}\n\n${answer}`);
      }
      for (const step of page.sections.flatMap((s) => s.steps ?? [])) {
        expect(text).toContain(step);
      }
      for (const bullet of page.sections.flatMap((s) => s.bullets ?? [])) {
        expect(text).toContain(`- ${bullet}`);
      }
    }
  });
});
