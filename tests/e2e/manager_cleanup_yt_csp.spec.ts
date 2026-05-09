// Verifies the fixes shipped on branch fix/manager-cleanup-yt-csp:
//   #1 Manager screen has no "Invite Players" section.
//   #2 Manager screen has no per-team Kick button.
//   #3 Post-buzz countdown bar replaces the old pre-buzz round timer.
//   #4 Manager screen has no countdown bar (timer only on team + display).
//   #5 YouTube player iframe loads with a real 11-char video ID after the
//      first start_round (no more error 153 "blank embed URL").
//   #6 Manager network traffic stays bounded after 20s of idle - the
//      previous bug rebuilt the YT.Player every render and produced
//      ~10 req/s.
//
// CSP (#7) cannot be verified locally because Vite's dev server does not
// apply frontend/public/_headers; that fix only manifests after a
// Cloudflare Pages deploy.

import { test, expect } from "@playwright/test";
import { joinAsTeam } from "./fixtures/team-context";
import { openManagerAndCreateGame } from "./fixtures/manager-context";

test.describe("manager-cleanup-yt-csp branch", () => {
  test("manager screen has no Invite Players panel and no Kick button", async ({ browser }) => {
    const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
    const team = await joinAsTeam(browser, manager.gameCode, "Solo");

    // Wait for the team to show up in the manager's Teams panel so the
    // negative assertion below isn't racing the realtime hydrate. The
    // team name renders in BOTH the Scoreboard and the Teams panel, so
    // we wait for at least one occurrence.
    await expect(manager.page.getByText("Solo").first()).toBeVisible({ timeout: 10_000 });

    // #1: no "Invite Players" heading anywhere.
    await expect(
      manager.page.getByRole("heading", { name: /invite players/i }),
    ).toHaveCount(0);

    // The manager page also no longer renders a QR code (DisplayPage still
    // does, hence the page-scoped check rather than a global one).
    await expect(manager.page.locator("svg[role='img'][aria-label*='QR']")).toHaveCount(0);

    // #2: no Kick button on the team row.
    await expect(manager.page.getByTestId("kick-team")).toHaveCount(0);
    await expect(
      manager.page.getByRole("button", { name: /^kick$/i }),
    ).toHaveCount(0);

    await team.page.close();
    await manager.page.close();
  });

  test("manager screen never renders a countdown timer; team + display do, only after buzz", async ({
    browser,
  }) => {
    const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });
    const code = manager.gameCode;
    const team = await joinAsTeam(browser, code, "Solo");

    const displayCtx = await browser.newContext();
    const display = await displayCtx.newPage();
    await display.goto(`/display/${code}`);
    await expect(display.getByText("Solo")).toBeVisible({ timeout: 10_000 });

    // Start a round.
    await expect(manager.page.getByTestId("start-round")).toBeEnabled();
    await manager.page.getByTestId("start-round").click();
    await expect(
      manager.page.getByText(new RegExp(`Round 1$`, "i")),
    ).toBeVisible({ timeout: 10_000 });

    // PRE-buzz: no timer on any of the three roles.
    // (Old behaviour: 20s pre-buzz countdown on team + manager.)
    await expect(manager.page.getByRole("timer")).toHaveCount(0);
    await expect(team.page.getByRole("timer")).toHaveCount(0);
    await expect(display.getByRole("timer")).toHaveCount(0);

    // Team buzzes.
    await team.page.getByTestId("buzz").click();
    await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
      timeout: 10_000,
    });

    // POST-buzz: timer on team + display, NOT on manager.
    await expect(manager.page.getByRole("timer")).toHaveCount(0);
    const teamTimer = team.page.getByRole("timer");
    const displayTimer = display.getByRole("timer");
    await expect(teamTimer).toBeVisible({ timeout: 5_000 });
    await expect(displayTimer).toBeVisible({ timeout: 5_000 });

    // Both timers count down (initial value at most 10, drops within ~3s).
    const startTeam = parseInt(((await teamTimer.textContent()) ?? "").replace(/\D/g, ""), 10);
    expect(startTeam).toBeGreaterThan(0);
    expect(startTeam).toBeLessThanOrEqual(10);

    await team.page.waitForTimeout(3_000);
    const laterTeam = parseInt(((await teamTimer.textContent()) ?? "").replace(/\D/g, ""), 10);
    expect(laterTeam).toBeLessThan(startTeam);

    // Manager scores; lock clears; timers disappear on team + display.
    await manager.page.getByTestId("score-title").click();
    await manager.page.getByTestId("end-round").click();
    await expect(team.page.getByRole("timer")).toHaveCount(0, { timeout: 10_000 });
    await expect(display.getByRole("timer")).toHaveCount(0, { timeout: 10_000 });

    await display.close();
    await displayCtx.close();
    await team.page.close();
    await manager.page.close();
  });

  test("YouTube player loads the song after start_round (no more error 153)", async ({
    browser,
  }) => {
    const manager = await openManagerAndCreateGame(browser, { genreName: "Rock" });

    await expect(manager.page.getByTestId("start-round")).toBeEnabled();
    await manager.page.getByTestId("start-round").click();
    await expect(
      manager.page.getByText(/Round 1$/i),
    ).toBeVisible({ timeout: 10_000 });

    // The YT IFrame API does NOT mutate the iframe's `src` to include the
    // videoId; videos are loaded via postMessage. The visible signal that
    // a video actually loaded is that the iframe's `title` attribute
    // (auto-populated by the IFrame API from the video's metadata) is no
    // longer the empty/default string. With the bug (player rebuilt every
    // render before loadVideoById could land), title stayed empty and the
    // YT in-iframe error overlay rendered "שגיאה 153 / Video unavailable".
    const iframe = manager.page.locator("[data-testid='youtube-player'] iframe");
    await expect
      .poll(async () => (await iframe.getAttribute("title")) ?? "", { timeout: 20_000 })
      .toMatch(/.{3,}/); // any title with 3+ chars - actual song titles run much longer

    // The custom "Video unavailable; manager can pick a new song." overlay
    // (rendered by YouTubePlayer.tsx on YT onError) must NOT be visible.
    await expect(
      manager.page.getByText(/video unavailable/i),
    ).toHaveCount(0);

    // The song title also has to appear in the Round controls card -
    // proves selectSong returned a Song and the manager UI rendered it.
    await expect(
      manager.page.locator("[class*='songLine']").first(),
    ).toBeVisible({ timeout: 10_000 });

    await manager.page.close();
  });

  test("manager network traffic stays bounded - no per-second iframe rebuild", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Count outgoing requests on the manager context across the whole
    // exercise. The old bug rebuilt the YT.Player every render (~1 Hz)
    // and each rebuild fetches the iframe API + multiple chunks, so the
    // request count climbed by ~10 per second. After the fix the player
    // is mounted once; manager-page requests should be a small constant
    // plus a few realtime keepalives.
    let total = 0;
    let youtubeReqs = 0;
    page.on("request", (req) => {
      total++;
      const url = req.url();
      if (url.includes("youtube.com") || url.includes("ytimg.com")) {
        youtubeReqs++;
      }
    });

    // Drive the same UI flow but using a brand-new context so we own the
    // request listener. (openManagerAndCreateGame creates its own context;
    // we replicate the steps inline here for instrumentation.)
    await page.goto("/");
    await page.getByRole("link", { name: /host a game/i }).click();
    await expect(page).toHaveURL(/\/manager\/create$/);
    const genre = page.getByLabel(/^Rock$/i);
    await expect(genre).toBeVisible({ timeout: 10_000 });
    await genre.check();
    await page.getByRole("button", { name: /create game/i }).click();
    await page.waitForURL(/\/manager\/game\/[A-Z2-9]{6}$/, { timeout: 15_000 });
    await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
      timeout: 20_000,
    });

    // Snapshot counts immediately after the player has loaded; from this
    // point we expect very little new traffic for ~20s.
    const baselineTotal = total;
    const baselineYt = youtubeReqs;
    await page.waitForTimeout(20_000);
    const idleTotal = total - baselineTotal;
    const idleYt = youtubeReqs - baselineYt;

    // Headroom is generous; the bug was ~200 idle reqs (10/s * 20s).
    // A single mounted YT.Player + occasional realtime keepalives should
    // be well under 60 idle requests over 20s.
    expect.soft(idleTotal).toBeLessThan(60);
    expect.soft(idleYt).toBeLessThan(20);

    await page.close();
    await context.close();
  });
});
