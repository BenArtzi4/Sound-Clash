// Per-page HTML — runs after the client build, check-bundle and the server
// build of src/entry-server.tsx (see package.json "build").
//
// The app is one SPA, so every route used to be served the same index.html:
// one title, one description and an empty <div id="root"> for every page.
// Google renders JavaScript and eventually sees the real page, but link-preview
// bots (WhatsApp, Slack, iMessage), Bing in part and every AI search crawler
// read the raw HTML and never run a script. So each public page gets its own
// copy of the built index.html, written where Cloudflare Pages serves it
// (dist/how-to-play.html answers /how-to-play; a static file wins over the
// catch-all in _redirects), with:
//
//   - its own title, description, canonical and og/twitter text;
//   - its JSON-LD (src/seo/structuredData.ts);
//   - for pages marked `prerender`, its body: the markup App renders at that
//     URL, stamped data-prerendered="<path>" so main.tsx hydrates it in place,
//     plus the stylesheet and module preload of the page's lazy chunk
//     (`module`), so the markup paints styled before any script runs.
//
// The untouched shell (empty #root, the home page's head) is written to
// dist/spa-shell.html, which _redirects serves for the per-game screens
// (/join/CODE, /team/CODE, ...): they must not flash the home page's markup.
// A copy marked noindex is dist/404.html, which Pages serves with a real 404
// status for any URL that is neither a file nor one of those screens; the app
// it loads still sends the visitor home, as the router always has.
//
// Also written: dist/llms.txt and dist/llms-full.txt (src/seo/llms.ts).
//
// src/seo/pages.json is the single source: the runtime hook (routeHead.ts)
// reads the same file, so a page's head cannot differ between the first paint
// and a client-side navigation. Adding a public page = a route in App.tsx plus
// an entry there; nothing here changes.
//
// Every replaced tag must match the template EXACTLY ONCE, and every written
// file is read back and checked, so an edit to index.html that renames,
// duplicates or drops one of these tags fails the build instead of silently
// shipping a stale page.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DIST = "dist";
const SSR_ENTRY = join("dist-ssr", "entry-server.js");
const MANIFEST = join(DIST, ".vite", "manifest.json");
const SHELL = "spa-shell.html";

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
const ROOT = '<div id="root"></div>';
const HEAD_END = "</head>";

function fail(message) {
  console.error(`prerender: ${message}`);
  process.exit(1);
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function countOf(haystack, needle) {
  return haystack.split(needle).length - 1;
}

for (const { tag, re } of TAGS) {
  const count = template.match(re)?.length ?? 0;
  if (count !== 1) {
    fail(`${tag} matches ${count} times in ${DIST}/index.html (expected exactly 1)`);
  }
}
for (const marker of [ROOT, HEAD_END]) {
  const count = countOf(template, marker);
  if (count !== 1) fail(`${marker} appears ${count} times in ${DIST}/index.html (expected 1)`);
}
if (!existsSync(SSR_ENTRY)) fail(`${SSR_ENTRY} is missing (did the server build run?)`);
if (!existsSync(MANIFEST)) fail(`${MANIFEST} is missing (build.manifest must be on)`);

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const { render, structuredDataFor, llmsTxt, llmsFullTxt } = await import(
  pathToFileURL(resolve(SSR_ENTRY)).href
);

// The chunks index.html already loads: the entry and everything it imports.
function chunkClosure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const chunk = manifest[key];
  if (!chunk) fail(`${key} is not in ${MANIFEST}`);
  seen.add(key);
  for (const dep of chunk.imports ?? []) chunkClosure(dep, seen);
  return seen;
}
const initial = chunkClosure("index.html");

// The stylesheets and scripts a lazy page needs beyond the initial ones: its
// own chunk and the shared chunks it imports. The stylesheet links make the
// prerendered markup paint styled; Vite's loader sees a stylesheet already
// linked and does not add it twice when the chunk is imported.
function lazyAssets(module) {
  const chunk = manifest[module];
  if (!chunk?.isDynamicEntry) fail(`${module} is not a lazily-loaded chunk in ${MANIFEST}`);
  const css = [];
  const js = [];
  for (const key of chunkClosure(module)) {
    if (initial.has(key)) continue;
    js.push(`/${manifest[key].file}`);
    for (const file of manifest[key].css ?? []) css.push(`/${file}`);
  }
  return [
    ...css.map((href) => `<link rel="stylesheet" crossorigin href="${href}" />`),
    ...js.map((href) => `<link rel="modulepreload" crossorigin href="${href}" />`),
  ];
}

// JSON.stringify leaves "<" alone, and "</script>" in a string would end the
// block early; \u003c is the same character to a JSON parser.
function jsonLdTag(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

// "/" becomes origin + "/", which is the canonical form of the home page.
const urlFor = (path) => origin + path;

function withHead(page) {
  const values = {
    title: escapeHtml(page.title),
    description: escapeHtml(page.description),
    url: escapeHtml(urlFor(page.path)),
    ogTitle: escapeHtml(page.ogTitle ?? page.title),
    ogDescription: escapeHtml(page.ogDescription ?? page.description),
  };
  let html = template;
  for (const { re, html: renderTag } of TAGS) {
    // A function replacement, so a `$` in the text is never read as a
    // back-reference.
    html = html.replace(re, () => renderTag(values));
  }
  return { html, values };
}

function write(file, html) {
  const out = join(DIST, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return readFileSync(out, "utf8");
}

// The shell first, from the untouched template: "/" overwrites index.html.
const home = pages.find((p) => p.path === "/");
if (!home) fail('src/seo/pages.json has no "/" page');
const shell = write(SHELL, withHead(home).html);
if (!shell.includes(ROOT)) fail(`${DIST}/${SHELL}: #root is not empty`);
console.log(`prerender: ${DIST}/${SHELL} -> the per-game screens`);
const NOINDEX = '<meta name="robots" content="noindex" />';
const notFound = write(
  "404.html",
  shell.replace(HEAD_END, () => `  ${NOINDEX}\n  ${HEAD_END}`),
);
if (!notFound.includes(NOINDEX)) fail(`${DIST}/404.html: no noindex`);
console.log(`prerender: ${DIST}/404.html -> every unknown URL (404, noindex)`);

for (const page of pages) {
  const label = `${DIST}/${page.file}`;
  const { html: base, values } = withHead(page);
  let html = base;

  const head = structuredDataFor(page.path).map(jsonLdTag);
  if (page.prerender) {
    if (page.module) head.push(...lazyAssets(page.module));
    const { html: body } = await render(page.path);
    if (!body.trim()) fail(`${label}: render("${page.path}") returned no markup`);
    const root = `<div id="root" data-prerendered="${escapeHtml(page.path)}">${body}</div>`;
    html = html.replace(ROOT, () => root);
  }
  if (head.length) html = html.replace(HEAD_END, () => `${head.join("\n    ")}\n  ${HEAD_END}`);

  const written = write(page.file, html);
  const title = written.match(/<title>([^<]*)<\/title>/)?.[1];
  const canonical = written.match(/<link rel="canonical" href="([^"]*)" \/>/)?.[1];
  if (title !== values.title) fail(`${label}: title is "${title}", expected "${values.title}"`);
  if (canonical !== values.url) {
    fail(`${label}: canonical is "${canonical}", expected "${values.url}"`);
  }
  if (page.prerender && written.includes(ROOT)) fail(`${label}: #root is still empty`);
  for (const [, json] of written.matchAll(
    /<script type="application\/ld\+json">([^<]*)<\/script>/g,
  )) {
    try {
      JSON.parse(json);
    } catch {
      fail(`${label}: a JSON-LD block does not parse`);
    }
  }
  const kind = page.prerender ? "head + body" : "head";
  console.log(`prerender: ${label} -> ${page.title} (${urlFor(page.path)}, ${kind})`);
}

// lastmod is the date the page's text last changed (`updated`), not the build
// date: a sitemap that claims every page changed on every deploy teaches
// Google to ignore its lastmod.
const urls = pages
  .filter((p) => p.inSitemap)
  .map((p) => {
    const lastmod = p.updated ? `<lastmod>${p.updated}</lastmod>` : "";
    return `  <url><loc>${escapeHtml(urlFor(p.path))}</loc>${lastmod}</url>`;
  });
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...urls,
  "</urlset>",
  "",
].join("\n");
writeFileSync(join(DIST, "sitemap.xml"), sitemap);
console.log(`prerender: ${DIST}/sitemap.xml -> ${urls.length} URLs`);

for (const [file, text] of [
  ["llms.txt", llmsTxt()],
  ["llms-full.txt", llmsFullTxt()],
]) {
  if (!text.startsWith("# Sound Clash")) fail(`${DIST}/${file} does not start with its H1`);
  writeFileSync(join(DIST, file), text);
  console.log(`prerender: ${DIST}/${file} -> ${text.length} characters`);
}

// Build-only artefacts: the manifest would otherwise be published, and the
// server bundle is never deployed.
rmSync(join(DIST, ".vite"), { recursive: true, force: true });
rmSync("dist-ssr", { recursive: true, force: true });
