// Phase 1 smoke test. Real specs in Phase 6.
import { expect, test } from "@playwright/test";

test("smoke: arithmetic", () => {
  expect(1 + 1).toBe(2);
});
