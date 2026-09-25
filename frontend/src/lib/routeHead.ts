import pagesJson from "../seo/pages.json";

// Keeps <head> in step with the route after a client-side navigation.
//
// The first load is already right: `npm run build` writes one HTML file per
// public page from the same pages.json (scripts/prerender-heads.mjs). But a tap
// from Home to How to play never reloads the document, so without this the tab
// would keep Home's title, and Google, which renders the SPA, would read the
// previous page's description and canonical.
//
// It updates the tags the static file ships (and creates one only if it is
// missing) rather than rendering <title>/<meta> from React: React 19 hoists
// those into <head> alongside the static ones, which leaves two titles.

export type SeoPage = {
  path: string;
  file: string;
  inSitemap: boolean;
  title: string;
  description: string;
  ogTitle?: string;
  ogDescription?: string;
};

export type SeoConfig = {
  origin: string;
  siteName: string;
  pages: SeoPage[];
};

export const seo: SeoConfig = pagesJson;

const home = seo.pages.find((p) => p.path === "/");
if (!home) throw new Error('src/seo/pages.json has no "/" page');
const HOME: SeoPage = home;

function normalize(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function pageFor(pathname: string): SeoPage | undefined {
  const path = normalize(pathname);
  return seo.pages.find((p) => p.path === path);
}

function setMeta(doc: Document, attr: "name" | "property", key: string, content: string) {
  let el = doc.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = doc.createElement("meta");
    el.setAttribute(attr, key);
    doc.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(doc: Document, href: string) {
  let el = doc.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = doc.createElement("link");
    el.setAttribute("rel", "canonical");
    doc.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// A per-game or unknown URL is served the fallback index.html, i.e. the "/"
// entry. It keeps that head (canonical = home) except for the tab title, which
// is just the brand: "Guess the Song…" would be wrong on a live game screen.
export function applyRouteHead(pathname: string, doc: Document = document): void {
  const page = pageFor(pathname);
  const source = page ?? HOME;
  const url = seo.origin + source.path;
  const ogTitle = source.ogTitle ?? source.title;
  const ogDescription = source.ogDescription ?? source.description;

  // The document.title setter updates the existing <title> (or creates one in
  // <head>); it never adds a second.
  doc.title = page ? page.title : seo.siteName;
  setMeta(doc, "name", "description", source.description);
  setCanonical(doc, url);
  setMeta(doc, "property", "og:url", url);
  setMeta(doc, "property", "og:title", ogTitle);
  setMeta(doc, "property", "og:description", ogDescription);
  setMeta(doc, "name", "twitter:title", ogTitle);
  setMeta(doc, "name", "twitter:description", ogDescription);
}
