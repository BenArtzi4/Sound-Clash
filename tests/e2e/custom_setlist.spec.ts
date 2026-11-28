// A game from a pasted song list (Custom Setlist phase 1, Task 12), end to end:
// the Host page's My own list tab, Check my list, Create game, the console's
// "Your songs" line, the host's songs first, then one more song by the same
// artist, then a list game's "no more songs" message.
//
// The list names three seed songs (db/seed/songs.sql) and one song that does
// not exist. Tier 2 ("more by the same artists") needs one more song by
// E2E Test Artist A, so the spec finds or creates "E2E Extra Song" through the
// admin API (which needs a genre: Mizrahit, which no other spec plays) and
// deletes it in afterAll only after a passing run. A failed run keeps it, so a
// CI retry finds the same row, the one whose id the backend's catalog cache
// already holds.
//
// The backend keeps the catalog for the matcher for 10 minutes
// (backend/app/services/setlist_catalog.py) and an admin song write does not
// reset it. Playwright starts a fresh backend, so a normal run is fine. But a
// backend reused on port 8000 that loaded the catalog in the last 10 minutes,
// also during an earlier run of this spec (passing or failing), may not hold
// this run's "E2E Extra Song" row: restart that backend before you run this
// spec.
//
// Rounds are advanced with the fixture's advanceRound, which waits for the
// round number that Realtime brings (committed state), not for a button flag.
// A list round can be the soundtrack Star Wars: the console then shows the
// film's name as its song line, so the titles below are read from that line.

import { test, expect, type Page } from "@playwright/test";
import { createSong, deleteSong, listGenres, listSongs } from "./fixtures/admin-api";
import { advanceRound } from "./fixtures/manager-context";
import { joinAsTeam } from "./fixtures/team-context";

const EXTRA_TITLE = "E2E Extra Song";
const EXTRA_ARTIST = "E2E Test Artist A";
// A real, embeddable video (the YouTube IFrame API's own sample) that the seed
// does not use: songs.youtube_id is unique (migration 042).
const EXTRA_YOUTUBE_ID = "M7lc1UVf-VE";
const EXTRA_GENRE_SLUG = "mizrahit";

const PASTED_LIST = [
  "E2E Test Artist A - E2E Test Song 1",
  "E2E Test Song 2 - E2E Test Artist B",
  "Star Wars",
  "Nobody - Not A Real Song",
].join("\n");

// What the console's song line shows for each list song.
const LIST_TITLES = ["E2E Test Song 1", "E2E Test Song 2", "Star Wars"];

let extraSongId: string | null = null;
let passed = false;

async function findOrCreateExtraSong(): Promise<string> {
  const found = await listSongs({ search: EXTRA_TITLE, per_page: 50 });
  const existing = found.items.find(
    (song) => song.title === EXTRA_TITLE && song.artist === EXTRA_ARTIST,
  );
  if (existing) return existing.id;
  const genre = (await listGenres()).find((g) => g.slug === EXTRA_GENRE_SLUG);
  if (!genre) throw new Error(`genre ${EXTRA_GENRE_SLUG} is missing from the local catalog`);
  const made = await createSong({
    title: EXTRA_TITLE,
    artist: EXTRA_ARTIST,
    youtube_id: EXTRA_YOUTUBE_ID,
    start_time: 0,
    genre_ids: [genre.id],
  });
  return made.id;
}

test.beforeAll(async () => {
  extraSongId = await findOrCreateExtraSong();
});

test.afterAll(async () => {
  if (passed && extraSongId) await deleteSong(extraSongId);
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The console's song line (the title, or the film's name in a soundtrack
// round), once it shows one of `candidates`. A round change can leave the
// previous round's line up for a moment, so it is polled; the candidates never
// include a song already played.
async function songOnConsole(page: Page, candidates: string[]): Promise<string> {
  const pattern = new RegExp(`^(?:${candidates.map(escapeRegExp).join("|")})$`);
  let title = "";
  await expect
    .poll(
      async () => {
        title = ((await page.getByTestId("song-title").allTextContents())[0] ?? "").trim();
        return title;
      },
      { message: `the console's song is one of: ${candidates.join(", ")}`, timeout: 15_000 },
    )
    .toMatch(pattern);
  return title;
}

async function expectProgress(page: Page, text: string): Promise<void> {
  await expect(page.getByTestId("setlist-progress")).toHaveText(text, { timeout: 15_000 });
}

async function waitForPlayer(page: Page): Promise<void> {
  // Same ceiling as openManagerAndCreateGame: data-ready waits on YouTube (issue #222).
  await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
    timeout: 40_000,
  });
}

test("a game from a pasted list plays the list first, then the same artist", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  // 1. The Host page: My own list, paste, check.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/manager/create");
  await page.getByTestId("music-source-list").click();
  await expect(page).toHaveURL(/\/manager\/create\/list$/);
  const input = page.getByTestId("setlist-input");
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(PASTED_LIST);
  await page.getByTestId("setlist-check").click();

  const result = page.getByTestId("setlist-result");
  await expect(result).toContainText("3 ready to play", { timeout: 15_000 });
  await expect(result).toContainText("1 cannot play");
  await expect(result).toContainText("+ 1 more by the same artists, played after your list");

  // 2. Create the game; the console opens with the host's token stored.
  const create = page.getByRole("button", { name: "Create game", exact: true });
  await expect(create).toBeEnabled();
  await create.click();
  await page.waitForURL(/\/manager\/game\/[A-Z2-9]{6}$/, { timeout: 15_000 });
  const code = page.url().match(/\/manager\/game\/([A-Z2-9]{6})$/)?.[1];
  if (!code) throw new Error(`failed to read the game code from ${page.url()}`);
  expect(
    await page.evaluate((c) => window.localStorage.getItem(`game:${c}:manager-token`), code),
  ).toBeTruthy();
  await waitForPlayer(page);
  await expectProgress(page, "Your songs: 3 of 3 left");

  // 3. One team joins; Start.
  await joinAsTeam(browser, code, "Setlist Fans");
  await expect(page.getByTestId("start-round")).toBeEnabled();
  await page.getByTestId("start-round").click();
  await expect(page.getByText(/Round 1$/i)).toBeVisible({ timeout: 15_000 });

  // 4. Rounds 1 to 3 play the list's three songs, in any order.
  const played: string[] = [];
  const unplayed = () => LIST_TITLES.filter((t) => !played.includes(t));

  played.push(await songOnConsole(page, unplayed()));
  await expectProgress(page, "Your songs: 2 of 3 left");

  await advanceRound(page);
  played.push(await songOnConsole(page, unplayed()));
  await expectProgress(page, "Your songs: 1 of 3 left");

  // A reload asks the server again: the line comes back the same.
  await page.reload();
  await waitForPlayer(page);
  await expect(page.getByText(/Round 2$/i)).toBeVisible({ timeout: 15_000 });
  await expectProgress(page, "Your songs: 1 of 3 left");
  await songOnConsole(page, [played[1]!]);

  await advanceRound(page);
  played.push(await songOnConsole(page, unplayed()));
  await expectProgress(page, "Your songs are done. Now: more by the same artists (1 left)");
  // songOnConsole takes only a list song not played yet, so rounds 1 to 3
  // played the three list songs, each once, before any other song.

  // 5. Round 4: the one more song by the same artist.
  await advanceRound(page);
  await songOnConsole(page, [EXTRA_TITLE]);
  await expectProgress(page, "Your songs are done. Now: more by the same artists (0 left)");

  // 6. Next round: nothing is left, so a list game's "no more songs" message.
  await expect(page.getByTestId("score-bonus")).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId("start-round")).toBeEnabled();
  await page.getByTestId("start-round").click();
  await expect(
    page
      .getByRole("region", { name: "Notifications" })
      .getByText(
        /^All your songs have been played\. End the game or start a new one with more songs\.$/,
      ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Round 4$/i)).toBeVisible();

  passed = true;
});
