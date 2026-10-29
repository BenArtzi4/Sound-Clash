// Display fit: the read-only top-5 board must render fully on screen with no
// page scroll at every realistic display/laptop resolution, and since
// 2026-10-29 on phones too, upright and sideways (a host with no computer
// mirrors a phone to the TV). Issue #179 caps the
// board at five teams, so the old many-team clip risk is gone — but this still
// guards that five roomy rows plus the reveal panel, token chips, timer, the
// "+N more teams" hint and the QR footer all fit without clipping or scrolling,
// even on short (often OS-scaled) laptop frames. It also pins the cap itself: a
// game with more than five teams shows exactly five rows and names the overflow
// in the hint, never a sixth row.
//
// It measures the RENDERED layout (bounding boxes vs the viewport), which a
// DOM-presence assertion can't catch. Game state is injected straight into the
// DB via the service role (the display reads Supabase directly — no manager /
// team / backend flow needed), in the worst-case "playing + a team buzzed"
// state where the reveal panel, token chips and timer all consume vertical
// space above the standings. The final screen gets the same check: podium and
// leaderboard on one frame, at every size.

import { test, expect, type Page } from "@playwright/test";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function svc(extra: Record<string, string> = {}): HeadersInit {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest(method: string, path: string, body?: unknown, ret = false): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: svc(ret ? { Prefer: "return=representation" } : { Prefer: "return=minimal" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text.length > 0 ? JSON.parse(text) : null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc() });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

// Inject a "playing, a team just buzzed" game with `n` teams and distinct
// descending scores. Idempotent per code (delete-cascade then re-create).
async function injectGame(code: string, n: number): Promise<void> {
  await rest("DELETE", `active_games?game_code=eq.${code}`); // cascades teams/rounds
  const songs = await getJson<Array<{ id: string }>>("songs?select=id&limit=1");
  const songId = songs[0]?.id;
  if (!songId) throw new Error("no song in catalog to attach to the injected round");

  await rest("POST", "active_games", {
    game_code: code,
    status: "playing",
    round_number: 3,
    current_song_id: songId,
  });
  await rest(
    "POST",
    "game_teams",
    Array.from({ length: n }, (_, i) => ({
      game_code: code,
      name: `Team ${String(i + 1).padStart(2, "0")}`,
      score: 170 - i * 7,
    })),
  );
  const rounds = (await rest(
    "POST",
    "game_rounds",
    { game_code: code, round_number: 3, song_id: songId },
    true,
  )) as Array<{ id: string }>;
  const top = await getJson<Array<{ id: string }>>(
    `game_teams?game_code=eq.${code}&select=id,score&order=score.desc&limit=1`,
  );
  await rest("PATCH", `active_games?game_code=eq.${code}`, {
    current_round_id: rounds[0]!.id,
    buzzed_team_id: top[0]!.id,
    locked_at: new Date().toISOString(),
  });
}

interface FitResult {
  total: number;
  clipped: string[];
  pageScrolls: boolean;
  emptyScores: string[];
  qrOut: boolean;
}

async function measureFit(page: Page): Promise<FitResult> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rows = [...document.querySelectorAll("[data-team-id]")];
    const clipped: string[] = [];
    const emptyScores: string[] = [];
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      const name = r.querySelector("span:nth-child(2)")?.textContent ?? "?";
      const score = r.querySelector("span:nth-child(3)")?.textContent ?? "";
      // 1px tolerance for sub-pixel rounding.
      if (b.top < -1 || b.bottom > vh + 1 || b.left < -1 || b.right > vw + 1) clipped.push(name);
      if (score.trim() === "") emptyScores.push(name);
    }
    const doc = document.scrollingElement!;
    const qr = document.querySelector("main footer svg")?.getBoundingClientRect();
    return {
      total: rows.length,
      clipped,
      pageScrolls: doc.scrollHeight > doc.clientHeight + 2,
      emptyScores,
      qrOut:
        !!qr && (qr.top < -1 || qr.bottom > vh + 1 || qr.left < -1 || qr.right > vw + 1),
    };
  });
}

// Realistic display + laptop resolutions, incl. OS-scaled short frames down to
// the TV layout's 640px floor.
const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1600, h: 900 },
  { w: 1536, h: 864 },
  { w: 1440, h: 900 },
  { w: 1366, h: 768 },
  { w: 1280, h: 800 },
  { w: 1280, h: 720 },
  { w: 1366, h: 680 },
  { w: 1280, h: 640 },
  { w: 1024, h: 640 },
];

// Phones upright and sideways (browser bars included where they apply), a
// portrait tablet and a netbook: the frames below the TV layout, which get
// their own non-scrolling layouts.
const SMALL_VIEWPORTS = [
  { w: 360, h: 640 },
  { w: 375, h: 548 }, // iPhone SE, Safari with both bars
  { w: 375, h: 667 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 568, h: 320 },
  { w: 640, h: 360 },
  { w: 740, h: 300 }, // Android sideways, status bar + Chrome toolbar
  { w: 844, h: 390 },
  { w: 932, h: 430 },
  { w: 1024, h: 600 },
];

const CAP = 5; // issue #179: the board shows only the top 5

// A valid display code is [A-Z2-9]{6}; keep them letters-only for simplicity.
const CASES: Array<{ code: string; teams: number }> = [
  { code: "FITFOR", teams: 4 }, // below the cap: every team shows, no hint
  { code: "FITTEN", teams: 10 },
  { code: "FITSIX", teams: 16 },
];

for (const { code, teams } of CASES) {
  const shown = Math.min(teams, CAP);
  const hidden = teams - shown;
  test(`display fits the top ${shown} of ${teams} teams across resolutions (no clip, no scroll)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await injectGame(code, teams);
    await page.goto(`/display/${code}`);
    // Only the top `shown` (by score) ever render; wait for that exact count.
    await expect(page.locator("[data-team-id]")).toHaveCount(shown, { timeout: 20_000 });
    // The overflow is named by the hint, not silently dropped.
    if (hidden > 0) {
      await expect(page.getByTestId("more-teams")).toHaveText(
        `+${hidden} more ${hidden === 1 ? "team" : "teams"} playing`,
      );
    } else {
      await expect(page.getByTestId("more-teams")).toHaveCount(0);
    }

    for (const vp of [...VIEWPORTS, ...SMALL_VIEWPORTS]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // The elastic grid + JS-driven QR size settle on resize; poll until the
      // board is fully on-screen (or fail with the offending rows named).
      await expect
        .poll(async () => (await measureFit(page)).clipped.length, {
          timeout: 8_000,
          message: `top ${shown} of ${teams} @ ${vp.w}x${vp.h}: some rows are clipped off-screen`,
        })
        .toBe(0);

      const fit = await measureFit(page);
      expect(fit.total, `top ${shown} @ ${vp.w}x${vp.h}: shown rows rendered`).toBe(shown);
      expect(fit.clipped, `top ${shown} @ ${vp.w}x${vp.h}: clipped rows`).toEqual([]);
      expect(fit.pageScrolls, `top ${shown} @ ${vp.w}x${vp.h}: page must not scroll`).toBe(false);
      expect(fit.emptyScores, `top ${shown} @ ${vp.w}x${vp.h}: rows with no score`).toEqual([]);
      expect(fit.qrOut, `top ${shown} @ ${vp.w}x${vp.h}: join QR leaves the frame`).toBe(false);
    }
  });
}

// The waiting screen gives the join panel half the frame and grows the QR to
// fill it (2026-10-27), so the room can scan it from across the room. Guard
// that the big QR and its text stay inside the frame, that the teams who have
// joined still fit, and that the QR really is big: at least twice its in-game
// size at every resolution.
async function injectWaitingGame(code: string, n: number): Promise<void> {
  await rest("DELETE", `active_games?game_code=eq.${code}`); // cascades teams
  await rest("POST", "active_games", { game_code: code, status: "waiting" });
  if (n > 0) {
    await rest(
      "POST",
      "game_teams",
      Array.from({ length: n }, (_, i) => ({
        game_code: code,
        name: `Team ${String(i + 1).padStart(2, "0")}`,
        score: 0,
      })),
    );
  }
}

// DisplayPage.tsx's in-game QR size for a frame of height h.
function inGameQr(h: number): number {
  return h < 700 ? 96 : h < 820 ? 118 : h < 950 ? 140 : 172;
}

interface LobbyFit {
  qr: number;
  panelOut: boolean;
  pageScrolls: boolean;
}

async function measureLobby(page: Page): Promise<LobbyFit> {
  return page.evaluate(() => {
    const panel = document.querySelector("main footer > div")!.getBoundingClientRect();
    const qr = document.querySelector("main footer svg")!.getBoundingClientRect();
    const doc = document.scrollingElement!;
    return {
      qr: Math.round(qr.width),
      panelOut:
        panel.top < -1 ||
        panel.left < -1 ||
        panel.bottom > window.innerHeight + 1 ||
        panel.right > window.innerWidth + 1,
      pageScrolls: doc.scrollHeight > doc.clientHeight + 2,
    };
  });
}

const LOBBY_CASES: Array<{ code: string; teams: number }> = [
  { code: "FITLBY", teams: 0 },
  { code: "FITLBT", teams: 3 },
  { code: "FITLBE", teams: 8 },
];

for (const { code, teams } of LOBBY_CASES) {
  const shown = Math.min(teams, CAP);
  test(`waiting screen: big join QR and ${teams} teams fit across resolutions`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await injectWaitingGame(code, teams);
    await page.goto(`/display/${code}`);
    await expect(page.getByText("Waiting for the host…")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-team-id]")).toHaveCount(shown, { timeout: 20_000 });
    await expect(page.locator("main footer svg")).toBeVisible();

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const min = 2 * inGameQr(vp.h);
      await expect
        .poll(async () => (await measureLobby(page)).qr, {
          timeout: 8_000,
          message: `${teams} teams @ ${vp.w}x${vp.h}: QR should be at least ${min}px`,
        })
        .toBeGreaterThanOrEqual(min);

      const lobby = await measureLobby(page);
      console.log(`waiting, ${teams} teams @ ${vp.w}x${vp.h}: QR ${lobby.qr}px`);
      expect(lobby.panelOut, `${teams} teams @ ${vp.w}x${vp.h}: join panel leaves the frame`).toBe(
        false,
      );
      expect(lobby.pageScrolls, `${teams} teams @ ${vp.w}x${vp.h}: page must not scroll`).toBe(
        false,
      );
      const fit = await measureFit(page);
      expect(fit.clipped, `${teams} teams @ ${vp.w}x${vp.h}: clipped rows`).toEqual([]);
    }

    // Below the TV layout the QR is smaller (the board shares the frame), but
    // the panel, the teams and the frame still have to fit.
    for (const vp of SMALL_VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await expect
        .poll(async () => (await measureFit(page)).clipped.length, {
          timeout: 8_000,
          message: `${teams} teams @ ${vp.w}x${vp.h}: some rows are clipped off-screen`,
        })
        .toBe(0);
      const lobby = await measureLobby(page);
      expect(lobby.panelOut, `${teams} teams @ ${vp.w}x${vp.h}: join panel leaves the frame`).toBe(
        false,
      );
      expect(lobby.pageScrolls, `${teams} teams @ ${vp.w}x${vp.h}: page must not scroll`).toBe(
        false,
      );
    }
  });
}

// The final screen (2026-10-29): the podium and the top-5 leaderboard on one
// frame with no scroll, at every size. Before, a 1366x768 laptop showed no
// leaderboard row and a sideways phone only the heading.
async function injectEndedGame(code: string, n: number): Promise<void> {
  await rest("DELETE", `active_games?game_code=eq.${code}`); // cascades teams
  await rest("POST", "active_games", { game_code: code, status: "waiting" });
  await rest(
    "POST",
    "game_teams",
    Array.from({ length: n }, (_, i) => ({
      game_code: code,
      name: i === 1 ? "Los Hermanos del Ritmo" : `Team ${String(i + 1).padStart(2, "0")}`,
      score: 90 - i * 9,
    })),
  );
  await rest("PATCH", `active_games?game_code=eq.${code}`, {
    status: "ended",
    ended_at: new Date().toISOString(),
  });
}

interface EndFit {
  rows: number;
  clipped: number;
  winnerOut: boolean;
  pageScrolls: boolean;
}

async function measureEnd(page: Page): Promise<EndFit> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = (b: DOMRect) => b.top < -1 || b.bottom > vh + 1 || b.left < -1 || b.right > vw + 1;
    const rows = [...document.querySelectorAll('[data-testid="final-scoreboard"] li')];
    const winner = [...document.querySelectorAll("main div")].find((el) =>
      /^WINNERS?$/.test(el.textContent ?? ""),
    );
    const doc = document.scrollingElement!;
    return {
      rows: rows.length,
      clipped: rows.filter((r) => out(r.getBoundingClientRect())).length,
      winnerOut: !winner || out(winner.getBoundingClientRect()),
      pageScrolls: doc.scrollHeight > doc.clientHeight + 2,
    };
  });
}

test("final screen: podium and leaderboard fit across resolutions", async ({ page }) => {
  test.setTimeout(120_000);
  await injectEndedGame("FITEND", 8);
  await page.goto(`/display/FITEND`);
  await expect(page.getByTestId("final-scoreboard")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="final-scoreboard"] li')).toHaveCount(CAP);

  for (const vp of [...VIEWPORTS, ...SMALL_VIEWPORTS]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await expect
      .poll(async () => (await measureEnd(page)).clipped, {
        timeout: 8_000,
        message: `final screen @ ${vp.w}x${vp.h}: leaderboard rows off-screen`,
      })
      .toBe(0);
    const end = await measureEnd(page);
    expect(end.winnerOut, `final screen @ ${vp.w}x${vp.h}: winner off-screen`).toBe(false);
    expect(end.pageScrolls, `final screen @ ${vp.w}x${vp.h}: page must not scroll`).toBe(false);
  }
});
