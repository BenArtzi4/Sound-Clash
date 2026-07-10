// Verifies the fixes shipped on branch fix/manager-cleanup-yt-csp:
//   #1 Manager screen has no "Invite Players" section.
//   #2 Manager screen has no per-team Kick button.
//   #3 Post-buzz countdown bar replaces the old pre-buzz round timer.
//   #4 Manager screen has no countdown bar (timer lives on the display only;
//      the team screen used to mirror it but no longer does — players have
//      the display in view and the team UI is now the full-bleed BUZZ).
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

    // Wait for the manager page to be fully hydrated before negative
    // assertions. The "Start game" / "Next round" button is always
    // present once the round-controls card has mounted; the manager page
    // no longer shows a Scoreboard or Teams list, so we can't wait on
    // the team name to appear.
    await expect(manager.page.getByTestId("start-round")).toBeVisible({ timeout: 10_000 });

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

  test("countdown timer lives on the display only; manager + team never render one", async ({
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
    await expect(manager.page.getByRole("timer")).toHaveCount(0);
    await expect(team.page.getByRole("timer")).toHaveCount(0);
    await expect(display.getByRole("timer")).toHaveCount(0);

    // Team buzzes.
    await team.page.getByTestId("buzz").click();
    await expect(team.page.getByTestId("buzz")).toHaveAttribute("data-tone", "winner", {
      timeout: 10_000,
    });

    // POST-buzz: timer ONLY on display. Manager and team never show it (the
    // team screen is now full-bleed BUZZ; players watch the display for time).
    await expect(manager.page.getByRole("timer")).toHaveCount(0);
    await expect(team.page.getByRole("timer")).toHaveCount(0);
    const displayTimer = display.getByRole("timer");
    await expect(displayTimer).toBeVisible({ timeout: 5_000 });

    const startDisplay = parseInt(
      ((await displayTimer.textContent()) ?? "").replace(/\D/g, ""),
      10,
    );
    expect(startDisplay).toBeGreaterThan(0);
    expect(startDisplay).toBeLessThanOrEqual(10);

    await display.waitForTimeout(3_000);
    const laterDisplay = parseInt(
      ((await displayTimer.textContent()) ?? "").replace(/\D/g, ""),
      10,
    );
    expect(laterDisplay).toBeLessThan(startDisplay);

    // Manager scores + advances; lock clears; the display timer disappears.
    await manager.page.getByTestId("score-title").click();
    await manager.page.getByTestId("start-round").click();
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

    // The song title also has to appear in the round-controls card -
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
      let host: string;
      try {
        host = new URL(req.url()).hostname;
      } catch {
        return;
      }
      if (
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "ytimg.com" ||
        host.endsWith(".ytimg.com")
      ) {
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
    // Two players mount on the manager console: the active one AND a standby
    // that muted-buffers (then freezes) the FIRST song during the "waiting"
    // lobby, so the host's Start tap can begin unmuted playback in-gesture
    // (mobile blocks audio that starts after the await). That is a deliberate
    // ONE-TIME video load, not the per-render YT.Player rebuild this test
    // guards against. Wait for both players to be ready and give the prebuffer
    // time to load + pause, THEN snapshot the baseline, so the idle window
    // measures steady state (which must stay bounded).
    // 40s ceiling on both players: onReady hinges on the third-party YouTube
    // IFrame API loading from www.youtube.com, whose latency varies on the
    // runner and occasionally exceeded 20s in a slow-network window (issue #222).
    await expect(page.getByTestId("youtube-player")).toHaveAttribute("data-ready", "true", {
      timeout: 40_000,
    });
    await expect(page.getByTestId("youtube-player-preload")).toHaveAttribute("data-ready", "true", {
      timeout: 40_000,
    });
    await page.waitForTimeout(8_000); // let the one-time first-song prebuffer load + freeze

    // Snapshot counts after the players + first-song prebuffer have loaded;
    // from this point we expect very little new traffic for ~20s.
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
