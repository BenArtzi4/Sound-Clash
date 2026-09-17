// frontend/src/fonts.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("fonts.css", () => {
  // Resolve via import.meta.dirname rather than `new URL(..., import.meta.url)`:
  // under the jsdom environment the global URL is jsdom's and resolves relative
  // paths against http://localhost/, not the file base.
  const css = readFileSync(join(import.meta.dirname, "fonts.css"), "utf8");
  it("declares the four self-hosted faces with swap and unicode-range", () => {
    for (const family of ["Anton", "Instrument Sans", "Secular One", "Heebo"]) {
      expect(css).toContain(`font-family: "${family}"`);
    }
    expect(css.match(/font-display: swap/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css.match(/unicode-range:/g)?.length).toBeGreaterThanOrEqual(4);
    expect(css).not.toMatch(/https?:\/\//); // same-origin only (CSP has no font-src)
  });
});
