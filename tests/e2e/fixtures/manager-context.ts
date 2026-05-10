// Open a manager browser context and create a game from the home page.
//
// Hosting is open: no password, no /manager/login. Game creation now
// returns a per-game manager_token, which the page stores in localStorage
// (`game:<code>:manager-token`) before navigating to /manager/game/<code>.
// We mirror that flow through the UI so subsequent manager-only API calls
// driven by the page (select-song, attempt, end-round, end, kick-team)
// attach the X-Manager-Token header automatically.
//
// For specs that need to drive the backend RPCs directly (e.g. forced
// expiration), `openManagerAndCreateGame` also returns the token; read
// it from `ManagerSession.managerToken` and forward it on REST requests.

import { type Browser, type Page, expect } from "@playwright/test";

export interface ManagerSession {
  page: Page;
  gameCode: string;
  managerToken: string;
}

interface CreateOpts {
  // Display name as it appears in the UI (e.g. "Rock", "Pop"), matched
  // case-insensitively.
  genreName: string;
}

export async function openManagerAndCreateGame(
  browser: Browser,
  opts: CreateOpts,
): Promise<ManagerSession> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Land on home and click the "Host a game" CTA.
  await page.goto("/");
  await page.getByRole("link", { name: /host a game/i }).click();
  await expect(page).toHaveURL(/\/manager\/create$/);

  // 2. Wait for genres to load (the form fetches them on mount).
  const genreLabel = page.getByLabel(new RegExp(`^${opts.genreName}$`, "i"));
  await expect(genreLabel).toBeVisible({ timeout: 10_000 });

  // 3. Pick a genre and submit.
  await genreLabel.check();
  await page.getByRole("button", { name: /create game/i }).click();

  // 4. App navigates to /manager/game/<code> client-side. Read the code
  //    out of the URL.
  await page.waitForURL(/\/manager\/game\/[A-Z2-9]{6}$/, { timeout: 15_000 });
  const match = page.url().match(/\/manager\/game\/([A-Z2-9]{6})$/);
  if (!match) throw new Error(`failed to read game code from URL: ${page.url()}`);
  const gameCode = match[1]!;

  // 5. Read the manager token the create-game flow stored in localStorage.
  const managerToken = await page.evaluate(
    (code) => window.localStorage.getItem(`game:${code}:manager-token`),
    gameCode,
  );
  if (!managerToken) {
    throw new Error(`manager token missing in localStorage for ${gameCode}`);
  }

  // 6. Wait for the YouTube player wrapper to flip to ready so the Start
  //    button enables.
  await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });

  return { page, gameCode, managerToken };
}

// ---------------------------------------------------------------------------
// Manager action helpers (multi-buzz round model)
//
// `awardAndContinue` toggles title/artist and presses "Continue round":
// the buzz is scored, the lock is cleared, and the same song keeps playing.
// `awardAndAdvance` does the same but presses "Next round" so the round
// closes and the next song loads.
//
// Wrong is its own one-click action (auto-fires `award_attempt`, no Continue
// press needed). Use `markWrong` for the wrong-buzz path.
//
// `skipRound` is the no-buzz timeout/skip path: presses "Next round"
// without any toggles set, advancing straight to the next song.
//
// `awardBonus` opens the bonus team picker and clicks the named team.
// ---------------------------------------------------------------------------

export interface AttemptToggles {
  title?: boolean;
  artist?: boolean;
}

async function setToggles(page: Page, toggles: AttemptToggles): Promise<void> {
  const setIf = async (testId: string, want: boolean | undefined) => {
    if (want !== true) return;
    const btn = page.getByTestId(testId);
    if ((await btn.getAttribute("aria-pressed")) === "true") return;
    await btn.click();
  };
  await setIf("score-title", toggles.title);
  await setIf("score-artist", toggles.artist);
}

export async function awardAndContinue(
  page: Page,
  toggles: AttemptToggles,
): Promise<void> {
  await setToggles(page, toggles);
  await page.getByTestId("continue-round").click();
  // Toggles reset on success; wait for the buttons to drop their pressed
  // state so the caller can chain another action without racing.
  await expect(page.getByTestId("score-title")).toHaveAttribute("aria-pressed", "false", {
    timeout: 10_000,
  });
}

// markWrong fires the Wrong verdict in one click. It does NOT need a
// follow-up Continue press: award_attempt runs immediately, the lock
// clears, and the buzzers re-arm. The -3 penalty is automatically waived
// by the SQL function if a correct answer was already scored this round
// (free-guess sweetener; see migration 017).
export async function markWrong(page: Page): Promise<void> {
  await page.getByTestId("score-wrong").click();
}

export async function awardAndAdvance(
  page: Page,
  toggles: AttemptToggles,
): Promise<void> {
  await setToggles(page, toggles);
  await page.getByTestId("start-round").click();
}

export async function skipRound(page: Page): Promise<void> {
  await page.getByTestId("start-round").click();
}

export async function awardBonusToTeam(page: Page, teamName: string): Promise<void> {
  await page.getByTestId("score-bonus").click();
  await page.getByRole("button", { name: teamName, exact: true }).click();
}
