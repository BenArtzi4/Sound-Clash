import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Screen changes are instant (docs/planning/ui-redesign/10-touch-and-route-motion.md).
// A page that fades itself up on arrival undoes that: the new screen swaps in,
// then blanks and loads a second time. Home keeps its fade-up for the moment
// the site opens, behind the attribute HomePage sets only then.
const read = (name: string) =>
  readFileSync(join(import.meta.dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule that declares an `animation`, as "selector { body }" strings. */
function animatedRules(css: string): string[] {
  const rules: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const [, selector = "", body = ""] = m;
    if (/(^|[\s;])animation(-name)?\s*:/.test(body)) rules.push(`${selector.trim()} {${body}}`);
  }
  return rules;
}

describe("arrival motion", () => {
  it("plays Home's fade-up only behind the first-open attribute", () => {
    const rules = animatedRules(read("HomePage.module.css")).filter((r) => r.includes("rise"));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).toContain('[data-intro="true"]');
  });

  it("gives How to play no arrival animation", () => {
    expect(animatedRules(read("HowToPlayPage.module.css"))).toEqual([]);
  });
});
