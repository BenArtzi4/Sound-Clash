// Realtime-frame-dropping harness for the buzzer resilience spec
// (buzzer_realtime_drops.spec.ts).
//
// Supabase Realtime never replays a postgres_changes event lost to a dropped
// socket frame or a silently half-open WebSocket (~25-50s undetected). The rest
// of the e2e suite only ever does a hard page reload; it never simulates a
// single dropped frame, which is exactly the class of outage that strands
// buzzers (#254 / #259).
//
// This module installs a man-in-the-middle on a team tab's Realtime WebSocket
// via page.routeWebSocket(): every frame is proxied both ways, EXCEPT the
// lock-clearing active_games UPDATEs a per-page, test-controlled
// `RealtimeDropControl` says to drop. Because the route handler runs in the Node
// (Playwright) process, the test flips the flag synchronously and the next
// server->client frame obeys it.
//
// Game control is driven by direct REST + PostgREST RPC (create via the FastAPI
// endpoint, advance/release via the token-gated RPCs the manager browser calls),
// NOT the manager console UI -- that dodges the YouTube-IFrame-ready 40s gate
// (#222) entirely, since the team page has no YouTube player. Only the buzzers
// under test are real browser tabs.

import { type Browser, type Page, expect } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const API_URL =
  process.env.API_URL ?? process.env.VITE_API_URL ?? "http://localhost:8000";

function anonHeaders(): HeadersInit {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL env var is required");
  if (!SUPABASE_ANON_KEY)
    throw new Error("SUPABASE_ANON_KEY env var is required");
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

async function resolveGenreId(slug: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/genres?slug=eq.${encodeURIComponent(slug)}&select=id`,
    { headers: anonHeaders() },
  );
  if (!res.ok)
    throw new Error(`GET genres failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ id: string }>;
  if (rows.length === 0) throw new Error(`no genre with slug=${slug}`);
  return rows[0]!.id;
}

export interface GameHandle {
  code: string;
  managerToken: string;
}

// Create a game through the real FastAPI create endpoint (open hosting), which
// returns the per-game manager_token exactly as the host browser receives it.
export async function createGame(genreSlug = "rock"): Promise<GameHandle> {
  const genreId = await resolveGenreId(genreSlug);
  const res = await fetch(`${API_URL}/games`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected_genres: [genreId] }),
  });
  if (!res.ok)
    throw new Error(`POST /games failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    game_code: string;
    manager_token: string;
  };
  return { code: body.game_code, managerToken: body.manager_token };
}

// PostgREST RPC helper mirroring how the browser calls the token-gated
// direct-RPCs. Returns the parsed JSON (a bare scalar, object, or the TABLE
// array), or null for a 204.
async function rpc(
  fn: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: anonHeaders(),
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rpc/${fn} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

export interface RoundInfo {
  round_id: string;
  round_number: number;
}

// "Start game" / "Next round": select_next_song closes any prior round and
// opens the next one in a single transaction (mig 022). Returns the new round.
export async function advanceRound(game: GameHandle): Promise<RoundInfo> {
  const data = await rpc("select_next_song", {
    p_game_code: game.code,
    p_manager_token: game.managerToken,
    // Explicit null (not undefined): PostgREST drops undefined keys and would
    // miss the 3-arg overload. See useSelectNextSong.ts.
    p_song_id: null,
  });
  const row = (Array.isArray(data) ? data[0] : data) as RoundInfo | null;
  if (!row)
    throw new Error("select_next_song returned no row (pool exhausted?)");
  return { round_id: row.round_id, round_number: row.round_number };
}

// "Continue round": release the buzz lock without scoring (mig 018/021). This
// is the signal-less lock-clear that carries no redundant Realtime event, so a
// tab that misses it can only recover via the 15s locked backstop (#259).
export async function releaseBuzzLock(game: GameHandle): Promise<void> {
  await rpc("release_buzz_lock", {
    p_game_code: game.code,
    p_manager_token: game.managerToken,
  });
}

// Per-tab, test-flipped drop rule. The route handler reads this live.
export interface RealtimeDropControl {
  // Drop only the active_games UPDATEs that CLEAR the lock (buzzed_team_id ->
  // null): the round-advance UPDATE and the release UPDATE. Lock-ACQUIRE
  // UPDATEs (buzzed_team_id -> a team) and all game_rounds / game_teams events
  // still pass, so a race still resolves and the round INSERT still lands for
  // the derivation (#254) / backstop (#259) to recover from.
  dropLockClears: boolean;
  // Count of frames actually dropped, for assertions/debugging.
  dropped: number;
}

function newControl(): RealtimeDropControl {
  return { dropLockClears: false, dropped: 0 };
}

// Robustly parse a Phoenix frame in either serialization: the object form
// `{event, payload}` or the v2 array form `[join_ref, ref, topic, event, payload]`.
function parseFrame(raw: string): { event: unknown; payload: unknown } | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(m)) return { event: m[3], payload: m[4] };
  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    return { event: o.event, payload: o.payload };
  }
  return null;
}

function shouldDropServerFrame(
  raw: string,
  ctrl: RealtimeDropControl,
): boolean {
  if (!ctrl.dropLockClears) return false;
  const frame = parseFrame(raw);
  if (!frame || frame.event !== "postgres_changes") return false;
  const payload = frame.payload as
    { data?: Record<string, unknown> } | undefined;
  const data = payload?.data;
  if (!data) return false;
  // Only the lock-clearing active_games UPDATEs. On the wire the server sends
  // `type` + `record` (realtime-js renames them to eventType/new before the app
  // sees them), but tolerate both shapes.
  const type = (data.type ?? data.eventType) as string | undefined;
  const record = (data.record ?? data.new ?? {}) as Record<string, unknown>;
  return (
    data.table === "active_games" &&
    type === "UPDATE" &&
    record.buzzed_team_id == null
  );
}

export interface DropTeam {
  page: Page;
  name: string;
  teamId: string;
  control: RealtimeDropControl;
}

// Open a fresh context, install the Realtime MITM BEFORE navigating (so the
// first WebSocket the app opens is already routed), then join the team through
// the real UI. Returns the tab plus its live drop-control handle.
export async function joinTeamWithDropControl(
  browser: Browser,
  game: GameHandle,
  name: string,
): Promise<DropTeam> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const control = newControl();
  const DBG = process.env.RTDROP_DEBUG === "1";

  await page.routeWebSocket(/\/realtime\//, (ws) => {
    if (DBG)
      console.log(`[rtdrop:${name}] route handler fired for ${ws.url()}`);
    const server = ws.connectToServer();
    // client -> server: always forward (buzz_in etc. go over REST, but channel
    // joins/heartbeats must reach the server so the socket stays healthy).
    ws.onMessage((message) => server.send(message));
    // server -> client: forward unless the drop rule matches.
    server.onMessage((message) => {
      if (
        typeof message === "string" &&
        shouldDropServerFrame(message, control)
      ) {
        control.dropped += 1;
        if (DBG)
          console.log(
            `[rtdrop:${name}] DROPPED lock-clear (total=${control.dropped})`,
          );
        return;
      }
      ws.send(message);
    });
  });

  await page.goto(`/join/${game.code}`);
  await page.locator("#game-code").fill(game.code);
  await page.locator("#team-name").fill(name);
  await page.getByRole("button", { name: /join game/i }).click();
  await expect(page).toHaveURL(new RegExp(`/team/${game.code}$`));
  await expect(page.getByTestId("buzz")).toBeVisible({ timeout: 15_000 });

  const teamId = await page.evaluate((code) => {
    const raw = window.localStorage.getItem(`game:${code}:team`);
    return raw ? (JSON.parse(raw) as { id: string }).id : "";
  }, game.code);
  if (!teamId)
    throw new Error(`team id missing in localStorage for ${game.code}`);

  return { page, name, teamId, control };
}
