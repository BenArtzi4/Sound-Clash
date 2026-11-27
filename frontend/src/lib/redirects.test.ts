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

// A route that ends in an optional segment (`/manager/create/:source?`) is
// one page at several addresses: the path without the segment, and each value
// the page knows. Its addresses are listed here; any other value must stay a
// real 404, so it gets no rule.
const OPTIONAL_SEGMENT_ADDRESSES: Record<string, string[]> = {
  "/manager/create/:source?": ["/manager/create/list"],
};
const OPTIONAL_SEGMENT = /\/:[A-Za-z]+\?$/;

function addresses(route: string): string[] {
  if (OPTIONAL_SEGMENT.test(route)) {
    return [route.replace(OPTIONAL_SEGMENT, ""), ...(OPTIONAL_SEGMENT_ADDRESSES[route] ?? [])];
  }
  // A param segment becomes a sample value, as a player's URL would be.
  return [route.replace(/:[A-Za-z]+/g, "ABCDEF")];
}

function servedBy(path: string): string | undefined {
  if (seo.pages.some((p) => p.path === path)) return "file";
  for (const [from, to, status] of rules) {
    if (status !== "200" || to !== "/spa-shell" || !from) continue;
    // "/team/*" serves everything under /team/; any other rule its exact path.
    if (from.endsWith("/*") ? path.startsWith(from.slice(0, -1)) : path === from) return from;
  }
  return undefined;
}

describe("public/_redirects", () => {
  it("finds App.tsx's routes", () => {
    expect(routes).toContain("/team/:gameCode");
    expect(routes).toContain("/manager/create/:source?");
  });

  it("lists the addresses of every route with an optional segment", () => {
    for (const route of routes.filter((r) => OPTIONAL_SEGMENT.test(r))) {
      expect(OPTIONAL_SEGMENT_ADDRESSES[route], route).toBeDefined();
    }
  });

  it.each(routes.filter((r) => r !== "*"))("serves the route %s", (route) => {
    for (const address of addresses(route)) {
      expect(servedBy(address), address).toBeDefined();
    }
  });

  it("serves My own list the SPA shell, and no other tab address", () => {
    expect(rules).toContainEqual(["/manager/create/list", "/spa-shell", "200"]);
    expect(servedBy("/manager/create/list")).toBe("/manager/create/list");
    expect(servedBy("/manager/create")).toBe("file");
    expect(servedBy("/manager/create/nope")).toBeUndefined();
    expect(servedBy("/manager/create/list/more")).toBeUndefined();
  });

  it("has no catch-all, so unknown URLs are a real 404", () => {
    expect(rules.some(([from]) => from === "/*")).toBe(false);
  });

  it("keeps the legacy /html/* redirect first", () => {
    expect(rules[0]).toEqual(["/html/*", "/", "301"]);
  });
});
