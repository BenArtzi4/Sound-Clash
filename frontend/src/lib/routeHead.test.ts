import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyRouteHead, pageFor, seo } from "./routeHead";

const ORIGIN = "https://www.soundclash.org";

// A document with an empty <head>: no <title>, no meta, no canonical.
function blankDoc(): Document {
  return document.implementation.createHTMLDocument();
}

function meta(doc: Document, attr: "name" | "property", key: string): string | null {
  return doc.head.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content") ?? null;
}

function canonical(doc: Document): string | null {
  return doc.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
}

const HOME = seo.pages.find((p) => p.path === "/");

describe("applyRouteHead", () => {
  it.each(seo.pages.map((p) => [p.path, p] as const))("applies the head for %s", (path, page) => {
    const doc = blankDoc();
    applyRouteHead(path, doc);

    const url = ORIGIN + page.path;
    const ogTitle = page.ogTitle ?? page.title;
    const ogDescription = page.ogDescription ?? page.description;
    expect(doc.title).toBe(page.title);
    expect(meta(doc, "name", "description")).toBe(page.description);
    expect(canonical(doc)).toBe(url);
    expect(meta(doc, "property", "og:url")).toBe(url);
    expect(meta(doc, "property", "og:title")).toBe(ogTitle);
    expect(meta(doc, "property", "og:description")).toBe(ogDescription);
    expect(meta(doc, "name", "twitter:title")).toBe(ogTitle);
    expect(meta(doc, "name", "twitter:description")).toBe(ogDescription);
  });

  it("keeps the brand-only share title on Home and the page title elsewhere", () => {
    const doc = blankDoc();
    applyRouteHead("/", doc);
    expect(meta(doc, "property", "og:title")).toBe("Sound Clash");

    applyRouteHead("/how-to-play", doc);
    expect(meta(doc, "property", "og:title")).toBe(doc.title);
  });

  it("normalises a trailing slash", () => {
    const doc = blankDoc();
    applyRouteHead("/how-to-play/", doc);
    expect(doc.title).toBe(pageFor("/how-to-play")?.title);
    expect(canonical(doc)).toBe(`${ORIGIN}/how-to-play`);
    expect(pageFor("/manager/create/")?.path).toBe("/manager/create");
    expect(pageFor("/")?.path).toBe("/");
  });

  it.each(["/team/ABCDEF", "/join/ABCDEF", "/manager/game/ABCDEF", "/admin/songs", "/nope"])(
    "gives %s the brand title and the home page's head",
    (path) => {
      const doc = blankDoc();
      applyRouteHead(path, doc);

      expect(pageFor(path)).toBeUndefined();
      expect(doc.title).toBe("Sound Clash");
      expect(canonical(doc)).toBe(`${ORIGIN}/`);
      expect(meta(doc, "property", "og:url")).toBe(`${ORIGIN}/`);
      expect(meta(doc, "name", "description")).toBe(HOME?.description);
      expect(meta(doc, "property", "og:title")).toBe(HOME?.ogTitle);
      expect(meta(doc, "name", "twitter:description")).toBe(HOME?.ogDescription);
    },
  );

  it("creates every tag a bare head is missing, once", () => {
    const doc = blankDoc();
    expect(doc.head.children).toHaveLength(0);

    applyRouteHead("/join", doc);

    expect(doc.querySelectorAll("title")).toHaveLength(1);
    expect(doc.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    for (const key of ["description", "twitter:title", "twitter:description"]) {
      expect(doc.head.querySelectorAll(`meta[name="${key}"]`)).toHaveLength(1);
    }
    for (const key of ["og:url", "og:title", "og:description"]) {
      expect(doc.head.querySelectorAll(`meta[property="${key}"]`)).toHaveLength(1);
    }
  });

  it("updates the static tags in place and never adds a second <title>", () => {
    const doc = blankDoc();
    doc.head.innerHTML = [
      "<title>Sound Clash</title>",
      '<meta name="description" content="old" />',
      '<link rel="canonical" href="https://www.soundclash.org/" />',
      '<meta property="og:title" content="old" />',
    ].join("");
    const staticTitle = doc.head.querySelector("title");

    applyRouteHead("/display", doc);
    applyRouteHead("/how-to-play", doc);
    applyRouteHead("/team/ABCDEF", doc);

    expect(doc.querySelectorAll("title")).toHaveLength(1);
    expect(doc.head.querySelector("title")).toBe(staticTitle);
    expect(doc.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(doc.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(doc.head.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
    expect(doc.title).toBe("Sound Clash");
  });

  it("defaults to the live document", () => {
    applyRouteHead("/how-to-play");
    expect(document.title).toBe(pageFor("/how-to-play")?.title);
    expect(canonical(document)).toBe(`${ORIGIN}/how-to-play`);
  });
});

describe("src/seo/pages.json", () => {
  // Route paths as declared in App.tsx, so an entry for a page that does not
  // exist (or was renamed) fails here rather than shipping a dead canonical.
  const appSource = readFileSync(join(import.meta.dirname, "..", "App.tsx"), "utf8");
  const routes = new Set([...appSource.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]));

  it("finds App.tsx's routes", () => {
    expect(routes).toContain("/");
    expect(routes).toContain("/how-to-play");
  });

  it("targets the canonical www origin", () => {
    expect(seo.origin).toBe(ORIGIN);
    expect(seo.siteName).toBe("Sound Clash");
  });

  it("has unique absolute paths that are real routes", () => {
    const paths = seo.pages.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith("/")).toBe(true);
      expect(routes).toContain(path);
    }
  });

  it("writes each page to the file Cloudflare Pages serves at its path", () => {
    expect(HOME?.file).toBe("index.html");
    for (const page of seo.pages) {
      expect(page.file.endsWith(".html")).toBe(true);
      if (page.path !== "/") expect(page.file).toBe(`${page.path.slice(1)}.html`);
    }
  });

  it.each(seo.pages.map((p) => [p.path, p] as const))(
    "gives %s a branded title and a 100-170 character description",
    (_path, page) => {
      expect(page.title).toContain("Sound Clash");
      expect(page.description.length).toBeGreaterThanOrEqual(100);
      expect(page.description.length).toBeLessThanOrEqual(170);
    },
  );

  it("puts Home and How to play in the sitemap", () => {
    const listed = seo.pages.filter((p) => p.inSitemap).map((p) => p.path);
    expect(listed).toEqual(expect.arrayContaining(["/", "/how-to-play"]));
  });
});
