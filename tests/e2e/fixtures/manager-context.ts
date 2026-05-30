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
  // Display name(s) as they appear in the UI (e.g. "Rock", "Pop"), matched
  // case-insensitively. Use `genreName` for a single genre or `genreNames`
  // to tick several (e.g. mix Soundtracks + Rock so a game draws both
  // soundtrack and normal rounds).
  genreName?: string;
  genreNames?: string[];
}

export async function openManagerAndCreateGame(
  browser: Browser,
  opts: CreateOpts,
): Promise<ManagerSession> {
  const context = await browser.newContext();
  const page = await context.newPage();

  const genres = opts.genreNames ?? (opts.genreName ? [opts.genreName] : []);
  if (genres.length === 0) throw new Error("openManagerAndCreateGame: no genre(s) given");

  // 1. Land on home and click the "Host a game" CTA.
  await page.goto("/");
  await page.getByRole("link", { name: /host a game/i }).click();
  await expect(page).toHaveURL(/\/manager\/create$/);

  // 2. Wait for genres to load (the form fetches them on mount), then tick
  //    each requested genre.
  for (const name of genres) {
    const genreLabel = page.getByLabel(new RegExp(`^${name}$`, "i"));
    await expect(genreLabel).toBeVisible({ timeout: 10_000 });
    await genreLabel.check();
  }

  // 3. Submit.
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
// Manager action helpers (multi-buzz round model, immediate-apply flow)
//
// Each judgement button fires the score the moment it's clicked:
//   - score-title    -> +10 to the buzzed team, lock STAYS held
//   - score-artist   -> +5 to the buzzed team, lock STAYS held
//   - score-wrong    -> -3 (or 0 with free-guess), lock RELEASED
//
// `awardAndContinue` clicks the requested correct buttons and then presses
// "Continue round" to release the lock and resume song playback. Use it
// when the round should keep going on the same song.
//
// `awardAndAdvance` clicks the requested correct buttons and then presses
// "Next round" to close the round and load the next song.
//
// `markWrong` is the wrong-buzz one-click path; the lock is released by
// the RPC, so no Continue press is needed.
//
// `skipRound` is the no-buzz timeout/skip path: presses "Next round"
// without scoring anything, advancing straight to the next song.
// ---------------------------------------------------------------------------

export interface AttemptToggles {
  title?: boolean;
  artist?: boolean;
}

async function applyCorrect(page: Page, toggles: AttemptToggles): Promise<void> {
  if (toggles.title === true) {
    await page.getByTestId("score-title").click();
    await expect(page.getByTestId("score-title")).toBeDisabled({ timeout: 10_000 });
  }
  if (toggles.artist === true) {
    await page.getByTestId("score-artist").click();
    await expect(page.getByTestId("score-artist")).toBeDisabled({ timeout: 10_000 });
  }
}

export async function awardAndContinue(
  page: Page,
  toggles: AttemptToggles,
): Promise<void> {
  await applyCorrect(page, toggles);
  await page.getByTestId("continue-round").click();
  // Continue releases the buzz lock; once released, Continue itself
  // disables again. Wait for that so the caller can chain.
  await expect(page.getByTestId("continue-round")).toBeDisabled({ timeout: 10_000 });
}

export async function markWrong(page: Page): Promise<void> {
  await page.getByTestId("score-wrong").click();
}

export async function awardAndAdvance(
  page: Page,
  toggles: AttemptToggles,
): Promise<void> {
  await applyCorrect(page, toggles);
  await page.getByTestId("start-round").click();
}

export async function skipRound(page: Page): Promise<void> {
  await page.getByTestId("start-round").click();
}

export async function awardBonusToTeam(page: Page, teamName: string): Promise<void> {
  await page.getByTestId("score-bonus").click();
  await page.getByRole("button", { name: teamName, exact: true }).click();
}
