import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { seo } from "./routeHead";

// public/_redirects has no /* catch-all (unknown URLs get a real 404 from
// dist/404.html, see docs/seo.md). So every client-side route must be served
// by something on Cloudflare Pages: a prerendered file (a pages.json entry) or
// a rewrite to the SPA shell. A route nobody serves would 404 for players.
const root = join(import.meta.dirname, "..", "..");
const appSource = readFileSync(join(root, "src", "App.tsx"), "utf8");
const redirects = readFileSync(join(root, "public", "_redirects"), "utf8");

const rules = redirects
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/));

const routes = [...appSource.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1] as string);

function servedBy(path: string): string | undefined {
  if (seo.pages.some((p) => p.path === path)) return "file";
  for (const [from, to, status] of rules) {
    if (status !== "200" || to !== "/spa-shell" || !from?.endsWith("/*")) continue;
    const prefix = from.slice(0, -1);
    if (path.startsWith(prefix)) return from;
  }
  return undefined;
}

describe("public/_redirects", () => {
  it("finds App.tsx's routes", () => {
    expect(routes).toContain("/team/:gameCode");
  });

  it.each(routes.filter((r) => r !== "*"))("serves the route %s", (route) => {
    // A param segment becomes a sample value, as a player's URL would be.
    const sample = route.replace(/:[A-Za-z]+/g, "ABCDEF");
    expect(servedBy(sample), route).toBeDefined();
  });

  it("has no catch-all, so unknown URLs are a real 404", () => {
    expect(rules.some(([from]) => from === "/*")).toBe(false);
  });

  it("keeps the legacy /html/* redirect first", () => {
    expect(rules[0]).toEqual(["/html/*", "/", "301"]);
  });
});
