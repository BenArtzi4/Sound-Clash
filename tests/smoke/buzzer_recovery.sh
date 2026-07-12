#!/usr/bin/env bash
# Sound Clash buzzer hot-path smoke. Run after a prod deploy to confirm the
# buzzer's REST/PostgREST path is healthy -- the path that keeps the buzzer
# working when a client's Realtime WebSocket is down.
#
# Why this proves WS-outage resilience: the buzzer is deliberately NOT on the
# Realtime path. buzz_in / release_buzz_lock / select_next_song are PL/pgSQL
# functions the browser calls DIRECT over PostgREST (plain HTTPS), independent
# of the Realtime WebSocket (docs/realtime-design.md; the #254 / #261 premise).
# This script has no WebSocket at all -- exactly a dead-socket client -- so a
# buzz_in that registers here, a re-arm after a release, and a round advance all
# demonstrate that a buzz still lands and the buzzer re-arms during a WS drop.
# The "button stays visibly enabled during reconnect" half is a frontend concern
# covered by the Playwright suite (TeamGameplayPage #254 test +
# buzzer_realtime_drops.spec.ts); this is the server-side counterpart.
#
# Usage:
#   SUPABASE_ANON_KEY=<public anon key> ./tests/smoke/buzzer_recovery.sh
#   SUPABASE_ANON_KEY=... ./tests/smoke/buzzer_recovery.sh https://api.example.com
#
# Config (env):
#   SUPABASE_URL        Supabase project URL. Default: prod (jvfddxuaqcsrguibkymp).
#   SUPABASE_ANON_KEY   The PUBLIC anon client key (the same one shipped in the
#                       frontend bundle -- not a secret). REQUIRED: the buzzer
#                       RPCs are direct PostgREST calls, so the key is needed.
#
# What it checks (in order):
#   1. POST /games (open hosting) + two team joins  (FastAPI)
#   2. select_next_song opens round 1                (PostgREST RPC)
#   3. buzz_in(Alpha) registers the lock over REST   (PostgREST RPC)  <- the buzz
#   4. buzz_in(Bravo) loses; the lock is atomic
#   5. release_buzz_lock clears the lock -> re-armed
#   6. buzz_in(Bravo) now wins -> a buzz registers again after re-arm
#   7. select_next_song advances the round
#   8. end-game flips status to "ended"              (FastAPI, self-cleaning)
#
# Prerequisites: bash, curl, jq. Exits non-zero on any HTTP failure or
# unexpected response shape.

set -euo pipefail

API_URL="${1:-https://api.soundclash.org}"
API_URL="${API_URL%/}"
SUPABASE_URL="${SUPABASE_URL:-https://jvfddxuaqcsrguibkymp.supabase.co}"
SUPABASE_URL="${SUPABASE_URL%/}"

log() { printf '[buzz-smoke] %s\n' "$*" >&2; }
fail() {
  printf '[buzz-smoke] FAIL: %s\n' "$*" >&2
  exit 1
}
require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"; }

require_cmd curl
require_cmd jq
[[ -n "${SUPABASE_ANON_KEY:-}" ]] || fail "SUPABASE_ANON_KEY is required (the public anon client key)"

# FastAPI 2xx wrapper (mirrors post_deploy.sh: --fail-with-body avoids the
# git-bash curl 8.8 '%{http_code}' bug while still surfacing the body).
http() {
  local method="$1" path="$2"
  shift 2
  local body
  if ! body=$(curl -sS --fail-with-body -X "$method" \
    -H 'Content-Type: application/json' "$@" "${API_URL}${path}"); then
    fail "$method $path failed: $body"
  fi
  printf '%s' "$body"
}

# PostgREST RPC wrapper: POST /rest/v1/rpc/<fn> with the anon key, exactly as the
# browser calls the token-gated direct-RPCs.
rpc() {
  local fn="$1" data="$2" body
  if ! body=$(curl -sS --fail-with-body -X POST \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    -H 'Content-Type: application/json' \
    --data "$data" "${SUPABASE_URL}/rest/v1/rpc/${fn}"); then
    fail "rpc/$fn failed: $body"
  fi
  printf '%s' "$body"
}

# PostgREST table read (anon SELECT on the Realtime-published active_games row).
get_game() {
  local body
  if ! body=$(curl -sS --fail-with-body \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
    "${SUPABASE_URL}/rest/v1/active_games?game_code=eq.${GAME_CODE}&select=status,round_number,buzzed_team_id"); then
    fail "GET active_games failed: $body"
  fi
  printf '%s' "$body"
}

# ---------------------------------------------------------------------------
# 1. create game + join two teams (FastAPI)
# ---------------------------------------------------------------------------

log "resolving genres (rock, pop) via GET /genres"
GENRES=$(http GET /genres)
ROCK_ID=$(jq -r '.[] | select(.slug == "rock") | .id' <<<"$GENRES")
POP_ID=$(jq -r '.[] | select(.slug == "pop") | .id' <<<"$GENRES")
[[ -n "$ROCK_ID" ]] || fail "no genre with slug=rock in /genres response"
[[ -n "$POP_ID" ]] || fail "no genre with slug=pop in /genres response"

log "1/8 POST /games (genres=rock+pop)"
CREATE_BODY=$(jq -n --arg rock "$ROCK_ID" --arg pop "$POP_ID" '{selected_genres: [$rock, $pop]}')
CREATE=$(http POST /games --data "$CREATE_BODY")
GAME_CODE=$(jq -r '.game_code // empty' <<<"$CREATE")
TOKEN=$(jq -r '.manager_token // empty' <<<"$CREATE")
[[ -n "$GAME_CODE" ]] || fail "create game returned no game_code: $CREATE"
[[ -n "$TOKEN" ]] || fail "create game returned no manager_token: $CREATE"
log "      game_code=$GAME_CODE"

# End the game on any failure past this point (self-cleaning).
cleanup() {
  local rc=$?
  if [[ -n "${GAME_CODE:-}" && -n "${TOKEN:-}" && "$rc" -ne 0 ]]; then
    log "      cleanup: ending game $GAME_CODE after failure"
    curl -sS -o /dev/null -X POST -H "X-Manager-Token: $TOKEN" \
      "${API_URL}/games/${GAME_CODE}/end" || true
  fi
  exit "$rc"
}
trap cleanup EXIT

TEAM_A=$(http POST "/games/$GAME_CODE/teams" --data '{"name":"buzz-alpha"}')
TEAM_B=$(http POST "/games/$GAME_CODE/teams" --data '{"name":"buzz-bravo"}')
TEAM_A_ID=$(jq -r '.id // empty' <<<"$TEAM_A")
TEAM_B_ID=$(jq -r '.id // empty' <<<"$TEAM_B")
[[ -n "$TEAM_A_ID" ]] || fail "team A insert returned no id: $TEAM_A"
[[ -n "$TEAM_B_ID" ]] || fail "team B insert returned no id: $TEAM_B"

# ---------------------------------------------------------------------------
# 2. open round 1 (select_next_song RPC)
# ---------------------------------------------------------------------------

log "2/8 select_next_song -> open round 1"
R1=$(rpc select_next_song "$(jq -n --arg c "$GAME_CODE" --arg t "$TOKEN" \
  '{p_game_code:$c, p_manager_token:$t, p_song_id:null}')")
R1_NUM=$(jq -r 'if type=="array" then .[0].round_number else .round_number end' <<<"$R1")
[[ "$R1_NUM" == "1" ]] || fail "select_next_song did not open round 1: $R1"

GAME_STATE=$(get_game)
[[ "$(jq -r '.[0].status' <<<"$GAME_STATE")" == "playing" ]] || fail "game not playing: $GAME_STATE"

# ---------------------------------------------------------------------------
# 3-4. buzz_in registers the lock over REST; the lock is atomic
# ---------------------------------------------------------------------------

log "3/8 buzz_in(Alpha) -> registers the lock over REST (no WebSocket involved)"
BUZZ_A=$(rpc buzz_in "$(jq -n --arg c "$GAME_CODE" --arg t "$TEAM_A_ID" '{p_game_code:$c, p_team_id:$t}')")
[[ "$(jq -r '.[0].locked' <<<"$BUZZ_A")" == "true" ]] || fail "Alpha buzz did not register: $BUZZ_A"
[[ "$(jq -r '.[0].locked_team_id' <<<"$BUZZ_A")" == "$TEAM_A_ID" ]] || fail "Alpha not the winner: $BUZZ_A"

log "4/8 buzz_in(Bravo) -> loses; lock is atomic (still Alpha)"
BUZZ_B=$(rpc buzz_in "$(jq -n --arg c "$GAME_CODE" --arg t "$TEAM_B_ID" '{p_game_code:$c, p_team_id:$t}')")
[[ "$(jq -r '.[0].locked' <<<"$BUZZ_B")" == "false" ]] || fail "Bravo should have lost the race: $BUZZ_B"
[[ "$(jq -r '.[0].locked_team_id' <<<"$BUZZ_B")" == "$TEAM_A_ID" ]] || fail "winner should still be Alpha: $BUZZ_B"

# ---------------------------------------------------------------------------
# 5-6. release re-arms; a buzz registers again
# ---------------------------------------------------------------------------

log "5/8 release_buzz_lock -> re-arm (buzzed_team_id cleared)"
rpc release_buzz_lock "$(jq -n --arg c "$GAME_CODE" --arg t "$TOKEN" '{p_game_code:$c, p_manager_token:$t}')" >/dev/null
GAME_STATE=$(get_game)
BUZZED=$(jq -r '.[0].buzzed_team_id // "null"' <<<"$GAME_STATE")
[[ "$BUZZED" == "null" ]] || fail "lock not cleared after release: $GAME_STATE"

log "6/8 buzz_in(Bravo) -> now wins; a buzz registers again after re-arm"
BUZZ_B2=$(rpc buzz_in "$(jq -n --arg c "$GAME_CODE" --arg t "$TEAM_B_ID" '{p_game_code:$c, p_team_id:$t}')")
[[ "$(jq -r '.[0].locked' <<<"$BUZZ_B2")" == "true" ]] || fail "Bravo did not win after re-arm: $BUZZ_B2"
[[ "$(jq -r '.[0].locked_team_id' <<<"$BUZZ_B2")" == "$TEAM_B_ID" ]] || fail "Bravo not the winner after re-arm: $BUZZ_B2"

# ---------------------------------------------------------------------------
# 7. round advances
# ---------------------------------------------------------------------------

log "7/8 select_next_song -> advance to round 2"
R2=$(rpc select_next_song "$(jq -n --arg c "$GAME_CODE" --arg t "$TOKEN" \
  '{p_game_code:$c, p_manager_token:$t, p_song_id:null}')")
R2_NUM=$(jq -r 'if type=="array" then .[0].round_number else .round_number end' <<<"$R2")
[[ "$R2_NUM" == "2" ]] || fail "select_next_song did not advance to round 2: $R2"

# ---------------------------------------------------------------------------
# 8. end game (self-cleaning)
# ---------------------------------------------------------------------------

log "8/8 POST /games/$GAME_CODE/end"
END=$(http POST "/games/$GAME_CODE/end" -H "X-Manager-Token: $TOKEN")
[[ "$(jq -r '.status // empty' <<<"$END")" == "ended" ]] || fail "end-game status not 'ended': $END"

trap - EXIT
log "PASS  game=$GAME_CODE  api=$API_URL  supabase=$SUPABASE_URL"
