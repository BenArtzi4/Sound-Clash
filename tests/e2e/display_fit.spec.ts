// Display fit: the read-only scoreboard must show EVERY team, fully on screen
// and with no page scroll, at every realistic display/laptop resolution — up to
// 16 teams. This guards the B-1.1 regression where the fixed-height rows + tall
// QR/top-matter starved the scoreboard on short (often OS-scaled) laptop frames
// and clipped the middle rows (a 10-team board showed only ranks 3 and 8).
//
// It measures the RENDERED layout (bounding boxes vs the viewport), which a
// DOM-presence assertion can't catch. Game state is injected straight into the
// DB via the service role (the display reads Supabase directly — no manager /
// team / backend flow needed), in the worst-case "playing + a team buzzed"
// state where the reveal panel, token chips and timer all consume vertical
// space above the standings.

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
    return {
      total: rows.length,
      clipped,
      pageScrolls: doc.scrollHeight > doc.clientHeight + 2,
      emptyScores,
    };
  });
}

// Realistic display + laptop resolutions, incl. OS-scaled short frames down to
// the 640px fit-frame floor. (Below 640 the layout intentionally falls back to
// a scrolling page for phones / tiny windows.)
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

// A valid display code is [A-Z2-9]{6}; keep them letters-only for simplicity.
const CASES: Array<{ code: string; teams: number }> = [
  { code: "FITTEN", teams: 10 },
  { code: "FITXIV", teams: 13 },
  { code: "FITSIX", teams: 16 },
];

for (const { code, teams } of CASES) {
  test(`display fits all ${teams} teams across resolutions (no clip, no scroll)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await injectGame(code, teams);
    await page.goto(`/display/${code}`);
    // Wait for the board to hydrate all teams before measuring.
    await expect(page.locator("[data-team-id]")).toHaveCount(teams, { timeout: 20_000 });

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // The elastic grid + JS-driven QR size settle on resize; poll until the
      // board is fully on-screen (or fail with the offending rows named).
      await expect
        .poll(async () => (await measureFit(page)).clipped.length, {
          timeout: 8_000,
          message: `${teams} teams @ ${vp.w}x${vp.h}: some rows are clipped off-screen`,
        })
        .toBe(0);

      const fit = await measureFit(page);
      expect(fit.total, `${teams} teams @ ${vp.w}x${vp.h}: all rows rendered`).toBe(teams);
      expect(fit.clipped, `${teams} teams @ ${vp.w}x${vp.h}: clipped rows`).toEqual([]);
      expect(fit.pageScrolls, `${teams} teams @ ${vp.w}x${vp.h}: page must not scroll`).toBe(false);
      expect(fit.emptyScores, `${teams} teams @ ${vp.w}x${vp.h}: rows with no score`).toEqual([]);
    }
  });
}
