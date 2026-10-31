import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeAbout } from "../components/HomeAbout";
import { seo } from "../lib/routeHead";
import { HOME_FAQ, HOME_VIDEO } from "./homeContent";
import { LANDING_CONTENT } from "./landingContent";
import {
  APP_JSON_LD,
  ORGANIZATION_JSON_LD,
  VIDEO_JSON_LD,
  structuredDataFor,
} from "./structuredData";

type Block = Record<string, unknown>;

describe("structuredDataFor", () => {
  it("describes the app, its publisher and its FAQ on Home", () => {
    const blocks = structuredDataFor("/") as Block[];
    expect(blocks.map((b) => b["@type"])).toEqual([
      "Organization",
      ["WebApplication", "VideoGame"],
      "VideoObject",
      "FAQPage",
    ]);
    expect(APP_JSON_LD.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    expect(APP_JSON_LD.publisher).toEqual({ "@id": ORGANIZATION_JSON_LD["@id"] });
    expect(APP_JSON_LD.url).toBe(`${seo.origin}/`);
    expect(APP_JSON_LD.description).toBe(seo.pages.find((p) => p.path === "/")?.description);
  });

  it("gives every landing page its FAQ and nothing to the form pages", () => {
    for (const page of LANDING_CONTENT) {
      const [faq, ...rest] = structuredDataFor(page.path) as Block[];
      expect(rest).toEqual([]);
      expect(faq?.["@type"]).toBe("FAQPage");
      expect(faq?.url).toBe(seo.origin + page.path);
      expect(faq?.mainEntity).toHaveLength(page.faq.length);
    }
    for (const path of ["/how-to-play", "/join", "/manager/create", "/display", "/team/ABC"]) {
      expect(structuredDataFor(path)).toEqual([]);
    }
  });

  // Google's rule for structured data: it must describe what the page shows,
  // and we have no ratings or reviews to claim.
  it("never claims a rating or review", () => {
    const all = JSON.stringify(seo.pages.flatMap((p) => structuredDataFor(p.path)));
    expect(all).not.toMatch(/aggregateRating|"review"|ratingValue/i);
  });

  it("matches Home's visible FAQ word for word", () => {
    const { container } = render(
      <MemoryRouter>
        <HomeAbout />
      </MemoryRouter>,
    );
    const faq = (structuredDataFor("/") as Block[]).find((b) => b["@type"] === "FAQPage");
    const entities = faq?.mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    const shown = [...container.querySelectorAll("h3")].map((h) => ({
      q: h.textContent,
      a: h.nextElementSibling?.textContent,
    }));
    expect(shown).toEqual(entities.map((e) => ({ q: e.name, a: e.acceptedAnswer.text })));
    expect(entities).toHaveLength(HOME_FAQ.length);
  });

  // Google's required VideoObject fields (name, thumbnailUrl, uploadDate),
  // and every one of them the video Home actually shows.
  it("describes the video Home shows", () => {
    const { container } = render(
      <MemoryRouter>
        <HomeAbout />
      </MemoryRouter>,
    );
    expect(VIDEO_JSON_LD.name).toBe("How to play Sound Clash");
    expect(VIDEO_JSON_LD.uploadDate).toMatch(/^2026-10-31T\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(VIDEO_JSON_LD.duration).toBe("PT52S");
    expect(VIDEO_JSON_LD.embedUrl).toBe(`https://www.youtube.com/embed/${HOME_VIDEO.id}`);
    const poster = container.querySelector("figure img");
    expect(VIDEO_JSON_LD.thumbnailUrl[0]).toBe(poster?.getAttribute("src"));
    expect(VIDEO_JSON_LD.description.length).toBeGreaterThan(50);
  });
});
