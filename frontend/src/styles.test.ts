// frontend/src/styles.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve via import.meta.dirname rather than `new URL(..., import.meta.url)`:
// under the jsdom environment the global URL is jsdom's and resolves relative
// paths against http://localhost/, not the file base (same as fonts.test.ts).
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

describe("styles.css design tokens", () => {
  it("defines the redesign palette and motion tokens", () => {
    for (const t of [
      "--bg: #000000",
      "--surface: #121111",
      "--accent: #ff7a00",
      "--accent-ink: #000000",
      "--bone: #e9e4d9",
      "--text-muted: #b4a88f",
      "--positive: #4ade80",
      "--negative: #f2352b",
      "--ease-move: cubic-bezier(0.645, 0.045, 0.355, 1)",
      "--ease-arrive: cubic-bezier(0.155, 0.055, 0.14, 1)",
      "--dur-route: 240ms",
    ]) {
      expect(css).toContain(t);
    }
  });
  it("has no gradients, no blur, no transition: all, and no light-mode background", () => {
    expect(css).not.toMatch(/linear-gradient|radial-gradient/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/#f8fafc|#e0e7ff|#dbeafe/);
  });
  it("keeps the legacy aliases so untouched modules still compile", () => {
    for (const alias of ["--color-primary:", "--space-md:", "--radius-md:", "--easing-spring:"]) {
      expect(css).toContain(alias);
    }
  });
  it("silences view-transition pseudo-elements under reduced motion", () => {
    expect(css).toMatch(/::view-transition-group\(\*\)[\s\S]*animation:\s*none/);
  });
});
