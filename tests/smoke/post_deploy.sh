#!/usr/bin/env bash
# Sound Clash post-deploy smoke. Run after every prod deploy.
#
# Usage:
#   ./tests/smoke/post_deploy.sh                          # defaults to https://api.soundclash.org
#   ./tests/smoke/post_deploy.sh https://api.example.com  # against any backend URL
#
# What it checks (in order):
#   1. /health is 200 and reports supabase reachable
#   2. POST /games (open hosting) returns a game_code + manager_token
#   3. Two teams can join
#   4. end-game flips status to "ended"
#
# Scope note: the smoke only exercises FastAPI-routed endpoints. The hot-path
# RPCs the browser calls direct via Supabase PostgREST -- buzz_in (mig 006),
# award_attempt / release_buzz_lock (mig 021), select_next_song (mig 022) --
# are validated by the Playwright e2e suite (tests/e2e/), not here. As a
# result there is no /select-song or /end-round step: those routes were
# removed in the dead-code cleanup once the new direct-RPC flow had soaked
# on prod.
#
# Prerequisites: bash, curl, jq. No secrets needed (game hosting is open
# as of 2026-05-06; see migration 012 + CLAUDE.md).
#
# Exits non-zero on any HTTP failure or unexpected response shape.

set -euo pipefail

API_URL="${1:-https://api.soundclash.org}"
API_URL="${API_URL%/}" # strip trailing slash if present

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

log() {
  printf '[smoke] %s\n' "$*" >&2
}

fail() {
  printf '[smoke] FAIL: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_cmd curl
require_cmd jq

# Wrapper that asserts a 2xx and emits the body to stdout. Uses
# --fail-with-body (curl 7.76+) so curl exits non-zero on HTTP errors
# while still streaming the body: gives us the detail in the failure
# message without the -w '%{http_code}' invocation that trips git-bash
# bundled curl 8.8.0 (exits 43). Portable across git-bash, macOS, and
# CI Ubuntu.
http() {
  local method="$1"
  local path="$2"
  shift 2

  local body
  if ! body=$(curl -sS --fail-with-body -X "$method" \
    -H 'Content-Type: application/json' \
    "$@" \
    "${API_URL}${path}"); then
    fail "$method $path failed: $body"
  fi
  printf '%s' "$body"
}

# ---------------------------------------------------------------------------
# 1. health
# ---------------------------------------------------------------------------

log "1/4 GET /health"
HEALTH=$(http GET /health)
HEALTH_STATUS=$(jq -r '.status // empty' <<<"$HEALTH")
HEALTH_VERSION=$(jq -r '.version // empty' <<<"$HEALTH")
HEALTH_SUPABASE=$(jq -r '.supabase // empty' <<<"$HEALTH")

[[ "$HEALTH_STATUS" == "ok" ]] || fail "/health status not ok: $HEALTH"
[[ -n "$HEALTH_VERSION" ]] || fail "/health missing version: $HEALTH"
log "      version=$HEALTH_VERSION supabase=$HEALTH_SUPABASE"

# ---------------------------------------------------------------------------
# 2. resolve genre UUIDs (selected_genres must be UUIDs per CreateGameRequest)
# ---------------------------------------------------------------------------

log "      resolving genres (rock, pop) via GET /genres"
GENRES=$(http GET /genres)

ROCK_ID=$(jq -r '.[] | select(.slug == "rock") | .id' <<<"$GENRES")
POP_ID=$(jq -r '.[] | select(.slug == "pop") | .id' <<<"$GENRES")
[[ -n "$ROCK_ID" ]] || fail "no genre with slug=rock in /genres response"
[[ -n "$POP_ID" ]] || fail "no genre with slug=pop in /genres response"

# ---------------------------------------------------------------------------
# 3. create game
# ---------------------------------------------------------------------------

log "2/4 POST /games (genres=rock+pop)"
CREATE_BODY=$(jq -n \
  --arg rock "$ROCK_ID" \
  --arg pop "$POP_ID" \
  '{selected_genres: [$rock, $pop]}')

CREATE=$(http POST /games --data "$CREATE_BODY")
GAME_CODE=$(jq -r '.game_code // empty' <<<"$CREATE")
TOKEN=$(jq -r '.manager_token // empty' <<<"$CREATE")
[[ -n "$GAME_CODE" ]] || fail "create game returned no game_code: $CREATE"
[[ -n "$TOKEN" ]] || fail "create game returned no manager_token: $CREATE"
log "      game_code=$GAME_CODE"

# Best-effort cleanup: end the game if anything below this point fails.
cleanup() {
  local rc=$?
  if [[ -n "${GAME_CODE:-}" && -n "${TOKEN:-}" && "$rc" -ne 0 ]]; then
    log "      cleanup: ending game $GAME_CODE after failure"
    curl -sS -o /dev/null -X POST \
      -H "X-Manager-Token: $TOKEN" \
      "${API_URL}/games/${GAME_CODE}/end" || true
  fi
  exit "$rc"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 4. join two teams
# ---------------------------------------------------------------------------

log "3/4 POST /games/$GAME_CODE/teams (Alpha, Bravo)"
TEAM_A=$(http POST "/games/$GAME_CODE/teams" --data '{"name":"smoke-alpha"}')
TEAM_B=$(http POST "/games/$GAME_CODE/teams" --data '{"name":"smoke-bravo"}')
TEAM_A_ID=$(jq -r '.id // empty' <<<"$TEAM_A")
TEAM_B_ID=$(jq -r '.id // empty' <<<"$TEAM_B")
[[ -n "$TEAM_A_ID" ]] || fail "team A insert returned no id: $TEAM_A"
[[ -n "$TEAM_B_ID" ]] || fail "team B insert returned no id: $TEAM_B"

# ---------------------------------------------------------------------------
# 5. end-game
# ---------------------------------------------------------------------------

log "4/4 POST /games/$GAME_CODE/end"
END=$(http POST "/games/$GAME_CODE/end" -H "X-Manager-Token: $TOKEN")
END_STATUS=$(jq -r '.status // empty' <<<"$END")
END_TS=$(jq -r '.ended_at // empty' <<<"$END")
[[ "$END_STATUS" == "ended" ]] || fail "end-game status not 'ended': $END"
[[ -n "$END_TS" ]] || fail "end-game missing ended_at: $END"
log "      ended_at=$END_TS"

# Disarm the failure-cleanup trap; we're exiting cleanly.
trap - EXIT

log "PASS  game=$GAME_CODE  api=$API_URL"
