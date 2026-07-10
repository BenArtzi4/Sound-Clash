import { describe, expect, it } from "vitest";

import {
  ARTIST_POINTS,
  BONUS_POINTS,
  SOUNDTRACK_POINTS,
  TITLE_POINTS,
  WRONG_BUZZ_PENALTY,
} from "./scoring";

// T-ScoringTest (T7.1): pin the client-side magnitudes to the game's scoring
// contract. award_attempt (mig 043) is the real source of truth for what lands
// on a team's score; these constants only drive the manager's optimistic toasts
// and button labels. If one drifts from the documented value (game-rules.md §4)
// without the other being updated, this test fails in CI.
describe("scoring constants", () => {
  it("match the documented game-rules values", () => {
    expect(TITLE_POINTS).toBe(10);
    expect(ARTIST_POINTS).toBe(5);
    expect(SOUNDTRACK_POINTS).toBe(15);
    expect(WRONG_BUZZ_PENALTY).toBe(3);
    expect(BONUS_POINTS).toBe(4);
  });

  it("keeps soundtrack = title + artist (the emergent both-flags identity)", () => {
    // handleCorrectSoundtrack fires both the title and artist flags; the DB sums
    // 10 + 5 = 15. If these drift apart the optimistic "+15" toast would lie
    // about the score the server actually commits.
    expect(TITLE_POINTS + ARTIST_POINTS).toBe(SOUNDTRACK_POINTS);
  });

  it("documents the manager bonus magnitude (award_bonus p_points DEFAULT 4)", () => {
    // The bonus flows through a *different* function (award_bonus, service-role;
    // mig 014 p_points DEFAULT 4, mirrored by AwardBonusRequest.points default 4
    // in backend/app/models/games.py). This is a documented cross-check, not an
    // import — keep it in sync with the backend default.
    expect(BONUS_POINTS).toBe(4);
  });
});
