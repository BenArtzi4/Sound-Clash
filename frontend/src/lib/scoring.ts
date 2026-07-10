// Scoring magnitudes — the single client-side source of truth for the point
// numbers the manager console shows (optimistic toasts + button labels).
//
// The DATABASE is authoritative for what is actually applied to a score:
// award_attempt (mig 043) takes booleans and derives these magnitudes
// server-side, so a tampered client can no longer send an arbitrary point value
// (T7.1 / D-7). These constants exist only so the optimistic UI matches the
// score the server will commit; scoring.test.ts pins them to the documented
// game-rules.md values so a silent drift is caught in CI.

// Naming the song: +10 (claims the TITLE token).
export const TITLE_POINTS = 10;
// Naming the artist: +5 (claims the ARTIST token).
export const ARTIST_POINTS = 5;
// Soundtrack rounds: a single "Correct" worth +15. Emergent as title+artist
// (both flags) through award_attempt — see useScoring.handleCorrectSoundtrack.
export const SOUNDTRACK_POINTS = 15;
// Wrong buzz: −3 (waived once per round by the free-guess flag; game-rules §4).
export const WRONG_BUZZ_PENALTY = 3;
// Manager discretionary bonus: +4, applied via a SEPARATE function (award_bonus,
// service-role, mig 014 p_points DEFAULT 4). Held here for the toast/label only.
export const BONUS_POINTS = 4;
