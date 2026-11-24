# Bind scoring to a buzz

A verdict or Continue applies to the buzz the host saw. An expired request leaves scores, claims, attempts and the current lock untouched. The fix uses the existing direct Supabase calls and the existing atomic buzzer update.

## Implementation

1. Add database regression cases for a verdict that arrives after Continue and a new buzz, including a new buzz by the same team. Cover a stale Continue, concurrent duplicate Song and Wrong, concurrent Song and Artist, advancement, and an authorization failure. Keep the existing scoring and one-winner tests.
2. Add migration 059. Assign a stable `buzz_attempt_id` from the existing row revision when a lock is acquired and publish it on the existing Broadcast event and Postgres row. Keep it through a score or a timer change, clear it on release or advance, and backfill already-held locks. Preserve the old RPC signatures during rollout and add overloads that accept the observed identity.
3. Serialize verdict transactions with the lock already used for round advance. Confirm the identity in the same transaction as the score and claim writes. Recheck it in the existing lock update so a concurrent release, kick, or new buzz rolls back any stale write. Continue checks its expected identity in its own conditional update. Keep the existing score values, free guess rules and lock timer.
4. Pass the identity from the host's game state through Correct Song, Correct Artist, Correct Soundtrack, Wrong and Continue. Show pending feedback immediately and refresh the view on a stale action. Keep a later buzz or round from inheriting pending buttons or a late playback resume. Never retry a stale scoring request automatically.
5. Update the schema, RPC, security and Realtime docs. Document the migration-first rollout, including the compatibility window for already-open tabs.

## Verification

- Demonstrate the old failure before implementation. Use deterministic SQL transaction ordering to cover a held row, same-team re-buzz, later round, duplicate verdicts, and a valid pair of different verdicts. Assert scores, attempt records, and lock ownership after each race.
- Check waiting, live and ended games, input and token validation, old overloads, migration reruns, existing held locks, timer refresh, Broadcast, snapshots, and dropped updates.
- Run the full database and frontend suites, lint, type checking, and build. Run the 10-call, 100-iteration buzzer race and a before/after local latency sample. Use the available multi-client browser checks to validate host/team/display agreement and recoveries. Record the exact boundaries and identify any staging or production checks that still need to run.

- Play at least ten rounds with four teams and a display before the PR is ready, then repeat after the migration, merge and deployment. Check competing presses, both claim types, a wrong answer and rebuzz, Continue, free guesses, a bonus, and final scores on each screen.
