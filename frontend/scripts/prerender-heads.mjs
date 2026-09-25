// Per-page <head> — runs after `vite build` and check-bundle (see package.json
// "build").
//
// The app is one SPA, so every route used to be served the same index.html:
// one title and one description for Home, How to play, Join, Host and Display
// alike. Google renders JavaScript and would eventually see the runtime head
// (src/lib/routeHead.ts), but link-preview bots (WhatsApp, Slack, iMessage)
// and most other crawlers read the raw HTML and never run a script. So each
// public page gets its own copy of the built index.html with its own title,
// description, canonical and og/twitter text, written where Cloudflare Pages
// serves it: dist/how-to-play.html answers /how-to-play, and a static file
// wins over the `/* /index.html 200` catch-all in _redirects. Every other URL
// (per-game pages, unknown paths) still falls through to index.html, which is
// the "/" entry.
//
// src/seo/pages.json is the single source: the runtime hook reads the same
// file, so a page's title cannot differ between the first paint and a
// client-side navigation. Adding a public page = a route in App.tsx plus an
// entry there; nothing here changes.
//
// Every tag is replaced by pattern, and each pattern must match the template
// EXACTLY ONCE. An edit to index.html that renames, duplicates or drops one of
// these tags fails the build here instead of silently shipping a stale head on
// five pages. The template is read before "/" overwrites dist/index.html, and
// re-running the script on its own output gives the same files.
//
// The sitemap lists the pages marked `inSitemap`; robots.txt (public/) points
// at it.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DIST = "dist";
const { origin, pages } = JSON.parse(readFileSync("src/seo/pages.json", "utf8"));
const template = readFileSync(join(DIST, "index.html"), "utf8");

// Attributes may be split across lines in index.html (`<meta\n  name=...`),
// hence \s+ between them rather than a single space.
const TAGS = [
  { tag: "<title>", re: /<title>[^<]*<\/title>/g, html: (v) => `<title>${v.title}</title>` },
  {
    tag: 'meta name="description"',
    re: /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/g,
    html: (v) => `<meta name="description" content="${v.description}" />`,
  },
  {
    tag: 'link rel="canonical"',
    re: /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/g,
    html: (v) => `<link rel="canonical" href="${v.url}" />`,
  },
  {
    tag: 'meta property="og:url"',
    re: /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/g,
    html: (v) => `<meta property="og:url" content="${v.url}" />`,
  },
  {
    tag: 'meta property="og:title"',
    re: /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/g,
    html: (v) => `<meta property="og:title" content="${v.ogTitle}" />`,
  },
  {
    tag: 'meta property="og:description"',
    re: /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/g,
    html: (v) => `<meta property="og:description" content="${v.ogDescription}" />`,
  },
  {
    tag: 'meta name="twitter:title"',
    re: /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/g,
    html: (v) => `<meta name="twitter:title" content="${v.ogTitle}" />`,
  },
  {
    tag: 'meta name="twitter:description"',
    re: /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/g,
    html: (v) => `<meta name="twitter:description" content="${v.ogDescription}" />`,
  },
];

function fail(message) {
  console.error(`prerender-heads: ${message}`);
  process.exit(1);
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

for (const { tag, re } of TAGS) {
  const count = template.match(re)?.length ?? 0;
  if (count !== 1) {
    fail(`${tag} matches ${count} times in ${DIST}/index.html (expected exactly 1)`);
  }
}

// "/" becomes origin + "/", which is the canonical form of the home page.
const urlFor = (path) => origin + path;

for (const page of pages) {
  const values = {
    title: escapeHtml(page.title),
    description: escapeHtml(page.description),
    url: escapeHtml(urlFor(page.path)),
    ogTitle: escapeHtml(page.ogTitle ?? page.title),
    ogDescription: escapeHtml(page.ogDescription ?? page.description),
  };

  let html = template;
  for (const { re, html: render } of TAGS) {
    // A function replacement, so a `$` in the text is never read as a
    // back-reference.
    html = html.replace(re, () => render(values));
  }

  const out = join(DIST, page.file);
  const label = `${DIST}/${page.file}`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);

  const written = readFileSync(out, "utf8");
  const title = written.match(/<title>([^<]*)<\/title>/)?.[1];
  const canonical = written.match(/<link rel="canonical" href="([^"]*)" \/>/)?.[1];
  if (title !== values.title) fail(`${label}: title is "${title}", expected "${values.title}"`);
  if (canonical !== values.url) {
    fail(`${label}: canonical is "${canonical}", expected "${values.url}"`);
  }
  console.log(`prerender-heads: ${label} -> ${page.title} (${urlFor(page.path)})`);
}

const urls = pages
  .filter((p) => p.inSitemap)
  .map((p) => `  <url><loc>${escapeHtml(urlFor(p.path))}</loc></url>`);
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls,
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(DIST, "sitemap.xml"), sitemap);
console.log(`prerender-heads: ${DIST}/sitemap.xml -> ${urls.length} URLs`);
