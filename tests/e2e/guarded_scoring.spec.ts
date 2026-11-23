import { expect, test } from "@playwright/test";
import { stubYouTube } from "./fixtures/buzz-frames";
import {
  advanceRound,
  openManagerAndCreateGame,
} from "./fixtures/manager-context";
import { buzzAndExpectWinner, joinAsTeam } from "./fixtures/team-context";

test("a delayed verdict cannot award points to the next team", async ({
  browser,
}) => {
  const host = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
    preparePage: stubYouTube,
  });
  const { page, gameCode } = host;
  const [alpha, bravo] = await Promise.all([
    joinAsTeam(browser, gameCode, "Alpha"),
    joinAsTeam(browser, gameCode, "Bravo"),
  ]);
  const displayContext = await browser.newContext();
  const display = await displayContext.newPage();
  await display.goto(`/display/${gameCode}`);
  await advanceRound(page);
  await buzzAndExpectWinner(alpha);
  await expect(page.getByTestId("status-text")).toContainText("Alpha");

  let sendVerdict!: () => void;
  const held = new Promise<void>((resolve) => {
    sendVerdict = resolve;
  });
  let intercepted!: () => void;
  const verdictStarted = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  const scoreUrl = "**/rest/v1/rpc/award_attempt";
  await page.route(scoreUrl, async (route) => {
    intercepted();
    await held;
    await route.continue();
  });

  try {
    await page.getByTestId("score-title").click();
    await verdictStarted;
    await page.getByTestId("continue-round").click();
    await buzzAndExpectWinner(bravo);
    await expect(page.getByTestId("status-text")).toContainText("Bravo");
    await expect(page.getByTestId("score-title")).toBeEnabled();

    sendVerdict();
    await expect(
      page.getByText(
        "That buzz changed. Check the current team before scoring.",
      ),
    ).toBeVisible();
    await expect(alpha.page.getByTestId("standing-score")).toHaveText("0 pts");
    await expect(bravo.page.getByTestId("standing-score")).toHaveText("0 pts");

    await page.unroute(scoreUrl);
    await page.getByTestId("score-title").click();
    await expect(bravo.page.getByTestId("standing-score")).toHaveText("10 pts");
    await expect(alpha.page.getByTestId("standing-score")).toHaveText("0 pts");
    await expect(
      display
        .locator("[data-team-id]")
        .filter({ hasText: "Bravo" })
        .filter({ hasText: "10" })
        .first(),
    ).toBeVisible();
    await expect(page.getByTestId("host-score")).toContainText(
      "Bravo · 10 pts",
    );
    await expect(bravo.page.getByTestId("buzz")).toHaveAttribute(
      "data-tone",
      "winner",
    );
  } finally {
    sendVerdict();
    await displayContext.close();
  }
});
