// frontend/src/hoverGuard.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Every `:hover` rule must sit inside `@media (hover: hover)` (ui-redesign 07
// Global Constraints; 05 §0 "Hover only under (hover: hover)"). On a touch
// screen a plain :hover sticks after the tap (#282), so a link stays underlined
// and a table row stays tinted until the next tap somewhere else. Ported from
// the validation plan's hover-guard.mjs (08 Appendix C); the 2026-09-22 final
// validation found two rules outside the guard (F-02).

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

/** Selectors containing `:hover` that are not nested in an `@media (hover: hover)` block. */
function unguardedHovers(source: string): string[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad: string[] = [];
  const stack: boolean[] = [];
  let guarded = 0;
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      const selector = buf.trim();
      const isGuard = /^@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(selector);
      stack.push(isGuard);
      if (isGuard) guarded += 1;
      if (selector.includes(":hover") && guarded === 0) bad.push(selector);
      buf = "";
    } else if (ch === "}") {
      if (stack.pop()) guarded -= 1;
      buf = "";
    } else if (ch === ";") {
      buf = "";
    } else {
      buf += ch;
    }
  }
  return bad;
}

describe("hover rules", () => {
  it("parses nesting: a guarded rule passes, a bare one and a reduced-motion one fail", () => {
    expect(unguardedHovers("@media (hover: hover) { .a:hover { color: red; } }")).toEqual([]);
    expect(unguardedHovers(".a:hover { color: red; }")).toEqual([".a:hover"]);
    expect(
      unguardedHovers("@media (prefers-reduced-motion: reduce) { .a:hover { color: red; } }"),
    ).toEqual([".a:hover"]);
    expect(
      unguardedHovers(
        "@media (prefers-reduced-motion: reduce) and (hover: hover) { .a:hover { color: red; } }",
      ),
    ).toEqual([]);
  });

  it("keeps every :hover in frontend/src inside @media (hover: hover)", () => {
    const root = import.meta.dirname;
    const bad: string[] = [];
    for (const file of cssFiles(root)) {
      for (const selector of unguardedHovers(readFileSync(file, "utf8"))) {
        bad.push(`${relative(root, file).replace(/\\/g, "/")}: ${selector}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
