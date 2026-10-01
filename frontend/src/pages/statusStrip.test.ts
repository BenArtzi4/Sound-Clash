import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The host console's buzz status line ("Waiting for a buzz…" / "<team> buzzed
// in — score it:") is centred in its box at every width, over the centred
// labels of the score grid. CSS modules don't resolve under vitest (css:
// false), so the rule is read off disk.
const css = readFileSync(
  join(import.meta.dirname, "ManagerConsolePage.module.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first top-level rule for an exact selector. */
function ruleBody(selector: string): string {
  const re = new RegExp(`(^|\\})\\s*\\${selector}\\s*\\{([^{}]*)\\}`);
  return re.exec(css)?.[2] ?? "";
}

describe("console status strip", () => {
  it("centres its text", () => {
    const body = ruleBody(".statusStrip");
    expect(body).toMatch(/justify-content:\s*center/);
    expect(body).toMatch(/text-align:\s*center/);
  });

  it("lets a long team name wrap inside the box", () => {
    const body = ruleBody(".statusText");
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("is not pushed back to the left at a narrower width", () => {
    // Every .statusStrip override (the phone one-screen-fit blocks) must leave
    // the alignment alone.
    const overrides = [...css.matchAll(/\.statusStrip\s*\{([^{}]*)\}/g)].map((m) => m[1] ?? "");
    expect(overrides.length).toBeGreaterThan(1);
    for (const body of overrides) {
      expect(body).not.toMatch(/justify-content:\s*(flex-start|start|left)/);
      expect(body).not.toMatch(/text-align:\s*(left|start)/);
    }
  });

  it("keeps the team name to one word space and the strip height steady", () => {
    // Measured in Chromium: a margin on the name doubled the literal space
    // (0.49em vs 0.19em), and the inherited 1.5 line-height made the locked
    // strip 1px taller than the waiting one.
    const body = ruleBody(".lockedTeam");
    expect(body).not.toMatch(/margin(-inline-end|-right)?\s*:/);
    expect(body).toMatch(/line-height:\s*1(\.[0-2])?\s*;/);
  });
});
