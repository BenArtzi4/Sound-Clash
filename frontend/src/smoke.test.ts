// Phase 1 smoke test. Real tests arrive in Phase 5 per docs/testing-strategy.md §4.3.
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("arithmetic still works", () => {
    expect(1 + 1).toBe(2);
  });
});
