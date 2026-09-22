// frontend/src/styles.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve via import.meta.dirname rather than `new URL(..., import.meta.url)`:
// under the jsdom environment the global URL is jsdom's and resolves relative
// paths against http://localhost/, not the file base (same as fonts.test.ts).
const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");

type Rgba = [number, number, number, number];

/** The `:root` value of a custom property, e.g. "#14120e" or "rgba(…, 0.42)". */
function token(name: string): string {
  const match = css.match(new RegExp(`\\${name}:\\s*([^;]+);`));
  if (!match?.[1]) throw new Error(`${name} is not defined in styles.css`);
  return match[1].trim();
}

function parse(colour: string): Rgba {
  const rgba = colour.match(/rgba?\(([^)]+)\)/);
  if (rgba?.[1]) {
    const parts = rgba[1].split(",").map((p) => Number(p.trim()));
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    return [r, g, b, a];
  }
  const hex = colour.match(/^#([0-9a-f]{6})$/i);
  if (!hex?.[1]) throw new Error(`unsupported colour syntax: ${colour}`);
  const n = Number.parseInt(hex[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: Rgba): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** `colour` (possibly translucent) flattened onto an opaque `ground`, as an rgb() string. */
function composite(colour: string, ground: string): string {
  const [r, g, b, a] = parse(colour);
  const [gr, gg, gb] = parse(ground);
  return `rgb(${r * a + gr * (1 - a)}, ${g * a + gg * (1 - a)}, ${b * a + gb * (1 - a)})`;
}

/** Contrast of a (possibly translucent) colour composited over an opaque ground. */
function contrastRatio(colour: string, ground: string): number {
  const [r, g, b, a] = parse(colour);
  const [gr, gg, gb] = parse(ground);
  const over: Rgba = [r * a + gr * (1 - a), g * a + gg * (1 - a), b * a + gb * (1 - a), 1];
  const [hi, lo] = [luminance(over), luminance([gr, gg, gb, 1])].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

describe("styles.css design tokens", () => {
  it("defines the redesign palette and motion tokens", () => {
    for (const t of [
      "--bg: #14120e",
      "--surface: #1d1a14",
      "--accent: #ff7a00",
      "--accent-ink: #000000",
      "--bone: #e9e4d9",
      "--text-muted: #b4a88f",
      "--positive: #4ade80",
      "--negative: #f2352b",
      "--negative-text: #ff5a4f",
      "--periwinkle: #a9b4ff",
      "--role-host: var(--accent)",
      "--role-play: var(--positive)",
      "--role-display: var(--periwinkle)",
      "--ease-move: cubic-bezier(0.645, 0.045, 0.355, 1)",
      "--ease-arrive: cubic-bezier(0.155, 0.055, 0.14, 1)",
      "--dur-route: 240ms",
    ]) {
      expect(css).toContain(t);
    }
  });
  // --border-strong is the ONLY visual on the unchecked genre checkbox
  // (ManagerCreateGamePage.module.css .genreCheck), so WCAG 1.4.11's 3:1 floor
  // for a boundary that identifies a control applies to it. It shipped at 0.32
  // (2.52:1). Asserting the literal would not survive a change to --bg — which
  // is what went stale in PR #323 — so the ratio is recomputed here instead.
  // docs/planning/FIX-2026-09-20-border-token-contrast.md
  it("keeps --border-strong at 3:1 against every ground it sits on", () => {
    for (const ground of ["--bg", "--surface", "--surface-2"]) {
      expect(contrastRatio(token("--border-strong"), token(ground))).toBeGreaterThanOrEqual(3);
    }
  });
  // Final validation 2026-09-22 (F-05): Home's "How to play" link and the toast's
  // close button still flashed the browser's tap overlay because only some
  // components reset it. One global floor, so a new control cannot forget.
  it("resets the browser tap highlight on every interactive element", () => {
    expect(css).toMatch(
      /a,\s*button,\s*input,\s*select,\s*textarea,\s*label,\s*summary,\s*\[role="button"\]\s*\{\s*-webkit-tap-highlight-color:\s*transparent;/,
    );
  });

  // Small red text (the Wrong label, error strips, "copy failed", the low
  // countdown) sits on the warm grounds and on --negative-soft. --negative itself
  // measures 4.40:1 on --surface since 09 moved the ground, under the 4.5:1
  // body-text floor (06 §6) — the 2026-09-22 final validation caught it on the
  // host console (P1) and How to play. --negative-text exists for exactly those
  // runs; fills, borders and >= 24 px text keep --negative.
  it("keeps --negative-text at 4.5:1 on every ground small red text sits on", () => {
    for (const ground of ["--bg", "--surface", "--surface-2"]) {
      expect(contrastRatio(token("--negative-text"), token(ground))).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(token("--negative-text"), composite(token("--negative-soft"), token(ground))),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("has no gradients, no blur, no transition: all, and no light-mode background", () => {
    expect(css).not.toMatch(/linear-gradient|radial-gradient/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/transition:\s*all/);
    expect(css).not.toMatch(/#f8fafc|#e0e7ff|#dbeafe/);
  });
  it("defines the real spacing and radius scales", () => {
    for (const token of [
      "--space-1:",
      "--space-4:",
      "--space-7:",
      "--radius-xs:",
      "--radius-sm:",
      "--radius-md:",
      "--radius-lg:",
      "--radius-pill:",
    ]) {
      expect(css).toContain(token);
    }
  });
  // The cleanup task removed the transitional aliases; this is the guard that
  // keeps them from creeping back in with a module that was never retokenised.
  it("no longer defines the legacy aliases", () => {
    for (const alias of [
      "--color-primary:",
      "--color-text:",
      "--color-border:",
      "--color-card:",
      "--space-md:",
      "--space-xl:",
      "--shadow-sm:",
      "--easing-spring:",
    ]) {
      expect(css).not.toContain(alias);
    }
  });
  it("silences view-transition pseudo-elements under reduced motion", () => {
    expect(css).toMatch(/::view-transition-group\(\*\)[\s\S]*animation:\s*none/);
  });
});
