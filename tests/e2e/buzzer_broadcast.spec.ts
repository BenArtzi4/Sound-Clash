import { expect, test, type Page } from "@playwright/test";
import {
  routeBuzzFrames,
  stubYouTube,
  type LockFrame,
} from "./fixtures/buzz-frames";
import { openManagerAndCreateGame } from "./fixtures/manager-context";
import { joinAsTeam } from "./fixtures/team-context";

const hostLocked = (page: Page) =>
  page.getByTestId("status-text").filter({ hasText: "Alpha buzzed in" });
const displayLocked = (page: Page) =>
  page.getByRole("status").filter({ hasText: "Alpha buzzed in!" });
const buzz = (page: Page) => page.getByTestId("buzz");
const idle = (page: Page) =>
  expect(buzz(page)).toHaveAttribute("data-tone", "idle");

test("private database Broadcast, delayed duplicates, and fallback lock delivery", async ({
  browser,
}) => {
  const host = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
    preparePage: stubYouTube,
  });
  let allowed: LockFrame["source"] | null = "broadcast";
  let callerReceivesLocks = false;
  let frames: LockFrame[] = [];
  const [alpha, bravo, display] = await Promise.all([
    joinAsTeam(browser, host.gameCode, "Alpha", (page) =>
      routeBuzzFrames(page, (frame) => {
        if (callerReceivesLocks) frame.deliver();
      }),
    ),
    joinAsTeam(browser, host.gameCode, "Bravo", (page) =>
      routeBuzzFrames(page, (frame) => {
        frames.push(frame);
        if (allowed === frame.source) frame.deliver();
      }),
    ),
    (async () => {
      const page = await (await browser.newContext()).newPage();
      await page.goto("/display/" + host.gameCode);
      return page;
    })(),
  ]);
  await host.page.getByTestId("start-round").click();
  await Promise.all([idle(alpha.page), idle(bravo.page)]);

  await buzz(alpha.page).click();
  await expect(buzz(alpha.page)).toHaveAttribute("data-tone", "winner");
  await expect(buzz(bravo.page)).toHaveAttribute("data-tone", "locked-other");
  await expect(hostLocked(host.page)).toBeVisible();
  await expect(displayLocked(display)).toBeVisible();
  await expect
    .poll(() => frames.map((frame) => frame.source).sort())
    .toEqual(["broadcast", "changes"]);
  expect(new Set(frames.map((frame) => frame.revision)).size).toBe(1);
  expect(new Set(frames.map((frame) => frame.team)).size).toBe(1);

  // Use the actual browser client with the same anonymous key as the app.
  const sender = await (await browser.newContext()).newPage();
  await sender.goto("/");
  const authorization = await sender.evaluate(async (code) => {
    const modulePath = "/src/lib/supabase.ts";
    const { supabase } = await import(modulePath);
    async function check(topic: string, privateChannel: boolean) {
      const channel = supabase.channel(topic, {
        config: { private: privateChannel, broadcast: { ack: true } },
      });
      try {
        const status = await new Promise<string>((resolve) =>
          channel.subscribe(resolve),
        );
        if (status !== "SUBSCRIBED") return { status };
        const result = await channel.send(
          {
            type: "broadcast",
            event: "buzz_locked",
            payload: { buzzed_team_id: "forged", buzz_revision: 1000000 },
          },
          { timeout: 750 },
        );
        return { status, result };
      } finally {
        await supabase.removeChannel(channel);
      }
    }
    return {
      unknown: await check("buzz:__missing__", true),
      private: await check("buzz:" + code, true),
      public: await check("buzz:" + code, false),
    };
  }, host.gameCode);
  expect(authorization.unknown.status).toBe("CHANNEL_ERROR");
  expect(authorization.private.status).toBe("SUBSCRIBED");
  expect(authorization.private.result).toMatch(/^(timed out|error)$/);
  expect(authorization.public).toEqual({ status: "SUBSCRIBED", result: "ok" });
  await host.page.getByTestId("continue-round").click();
  await Promise.all([idle(alpha.page), idle(bravo.page)]);
  await expect(displayLocked(display)).toHaveCount(0);
  expect(frames.some((frame) => frame.team === "forged")).toBe(false);
  for (const frame of frames) {
    frame.deliver();
    frame.deliver();
  }
  await bravo.page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await idle(bravo.page);

  callerReceivesLocks = true;
  allowed = "changes";
  frames = [];
  await buzz(alpha.page).click();
  await expect(buzz(bravo.page)).toHaveAttribute("data-tone", "locked-other");
  await expect
    .poll(() => frames.map((frame) => frame.source).sort())
    .toEqual(["broadcast", "changes"]);
  await host.page.getByTestId("continue-round").click();
  await Promise.all([idle(alpha.page), idle(bravo.page)]);

  allowed = null;
  frames = [];
  await buzz(alpha.page).click();
  await expect(displayLocked(display)).toBeVisible();
  await expect
    .poll(() => frames.map((frame) => frame.source).sort())
    .toEqual(["broadcast", "changes"]);
  await idle(bravo.page);
  await bravo.page.reload();
  await expect(buzz(bravo.page)).toHaveAttribute("data-tone", "locked-other");
  await host.page.getByTestId("score-title").click();
  await expect(
    display.locator('[data-team-id]:has-text("Alpha"):has-text("10")').first(),
  ).toBeVisible();
  await Promise.all(
    [host.page, alpha.page, bravo.page, display, sender].map((page) =>
      page.context().close(),
    ),
  );
});

type Sample = {
  revision: number;
  tap?: number;
  rpc?: number;
  receipt: Record<string, number>;
  paint: Record<string, number>;
};

function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (q: number) =>
    sorted.length
      ? +sorted[Math.ceil(q * sorted.length) - 1]!.toFixed(1)
      : null;
  return {
    n: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    under200: sorted.filter((v) => v < 200).length,
    over500: sorted.filter((v) => v > 500).length,
  };
}

test("paired buzzer receipts and screen paints for the same winning writes", async ({
  browser,
  browserName,
}, testInfo) => {
  const count = Number(process.env.BUZZ_COMPARE_SAMPLES ?? 0);
  test.skip(
    !count,
    "Set BUZZ_COMPARE_SAMPLES against isolated staging or the local stack",
  );
  test.setTimeout(Math.max(90_000, count * 8_000));
  let sample: Sample | undefined;
  const record = (role: string, source?: LockFrame["source"]) => (page: Page) =>
    routeBuzzFrames(page, (frame) => {
      if (sample?.revision === frame.revision) {
        sample.receipt[role + ":" + frame.source] ??= frame.received;
      }
      if (!source || source === frame.source) frame.deliver();
    });

  const host = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
    preparePage: async (page) => {
      await stubYouTube(page);
      await record("host", "broadcast")(page);
    },
  });
  const code = host.gameCode;
  const [alpha, bravo] = await Promise.all([
    joinAsTeam(browser, code, "Alpha", record("caller")),
    joinAsTeam(browser, code, "Bravo", record("team", "broadcast")),
  ]);
  async function mirror(
    role: string,
    path: string,
    original?: Page,
    source: LockFrame["source"] = "changes",
  ) {
    const context = await browser.newContext({
      storageState: await original?.context().storageState(),
    });
    const page = await context.newPage();
    if (role.startsWith("host")) await stubYouTube(page);
    await record(role, source)(page);
    await page.goto(path);
    return page;
  }
  const [display, hostBaseline, teamBaseline, displayBaseline] =
    await Promise.all([
      mirror("display", "/display/" + code, undefined, "broadcast"),
      mirror("hostBaseline", "/manager/game/" + code, host.page),
      mirror("teamBaseline", "/team/" + code, bravo.page),
      mirror("displayBaseline", "/display/" + code),
    ]);
  const pages = {
    caller: alpha.page,
    host: host.page,
    team: bravo.page,
    display,
    hostBaseline,
    teamBaseline,
    displayBaseline,
  };
  for (const [role, page] of Object.entries(pages)) {
    await page.exposeFunction("recordLockPaint", (kind: "pending" | "lock") => {
      if (!sample) return;
      const now = performance.now();
      if (role === "caller") sample.paint.firstFeedback ??= now;
      if (kind === "lock") sample.paint[role] ??= now;
    });
    await page.evaluate((role) => {
      const report = (
        window as unknown as {
          recordLockPaint: (kind: "pending" | "lock") => void;
        }
      ).recordLockPaint;
      let showing = false;
      let pending = false;
      const afterPaint = (then: () => void) =>
        requestAnimationFrame(() => requestAnimationFrame(then));
      new MutationObserver(() => {
        const tone = document
          .querySelector('[data-testid="buzz"]')
          ?.getAttribute("data-tone");
        const locked =
          role.startsWith("host") || role.startsWith("display")
            ? Array.from(document.querySelectorAll('[role="status"]')).some(
                (el) => el.textContent?.includes("Alpha buzzed in"),
              )
            : tone === (role === "caller" ? "winner" : "locked-other");
        if (locked && !showing)
          afterPaint(() => {
            if (showing) report("lock");
          });
        showing = locked;
        const pressing = role === "caller" && tone === "pending";
        if (pressing && !pending)
          afterPaint(() => {
            if (pending) report("pending");
          });
        pending = pressing;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    }, role);
  }
  await alpha.page.exposeFunction("recordBuzzTap", () => {
    if (sample) sample.tap ??= performance.now();
  });
  await alpha.page.evaluate(() => {
    document.addEventListener(
      "pointerdown",
      (event) => {
        if ((event.target as Element).closest('[data-testid="buzz"]')) {
          (window as unknown as { recordBuzzTap: () => void }).recordBuzzTap();
        }
      },
      true,
    );
  });
  alpha.page.on("response", async (response) => {
    if (response.url().endsWith("/rpc/buzz_in") && response.ok()) {
      await response.finished();
      if (sample) sample.rpc ??= performance.now();
    }
  });
  await host.page.getByTestId("start-round").click();
  const samples: Sample[] = [];
  const remotes = ["host", "team", "display"];
  const awaitingMeasurements = () =>
    sample?.tap !== undefined &&
    sample.rpc !== undefined &&
    Object.keys(pages).every((role) => sample!.paint[role] !== undefined) &&
    remotes.every(
      (role) =>
        sample!.receipt[role + ":broadcast"] &&
        sample!.receipt[role + ":changes"],
    );
  for (let i = 0; i <= count; i++) {
    await Promise.all([
      idle(alpha.page),
      idle(bravo.page),
      idle(teamBaseline),
      expect(displayLocked(displayBaseline)).toHaveCount(0),
    ]);
    const gameResponse = await alpha.page.request.get(
      process.env.SUPABASE_URL +
        "/rest/v1/active_games?select=buzz_revision&game_code=eq." +
        code,
      {
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY!,
          Authorization: "Bearer " + process.env.SUPABASE_ANON_KEY,
        },
      },
    );
    expect(gameResponse.ok()).toBe(true);
    const [game] = await gameResponse.json();
    sample = { revision: game.buzz_revision + 1, receipt: {}, paint: {} };
    await buzz(alpha.page).click();
    // Record individual misses with a common deadline, then continue the room.
    const deadline = performance.now() + 3000;
    while (!awaitingMeasurements() && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (i > 0) samples.push(sample);
    sample = undefined;
    await host.page.getByTestId("continue-round").click();
  }

  function times(keys: string[], stage: "receipt" | "paint") {
    return samples.map((s) =>
      s.tap !== undefined && keys.every((key) => s[stage][key] !== undefined)
        ? Math.max(...keys.map((key) => s[stage][key]!)) - s.tap
        : null,
    );
  }
  function paired(
    current: Array<number | null>,
    broadcast: Array<number | null>,
  ) {
    return {
      changes: summary(current.filter((v) => v !== null)),
      broadcast: summary(broadcast.filter((v) => v !== null)),
      pairedImprovement: summary(
        current.flatMap((v, i) =>
          v !== null && broadcast[i] !== null ? [v - broadcast[i]!] : [],
        ),
      ),
      missed: {
        changes: current.filter((v) => v === null).length,
        broadcast: broadcast.filter((v) => v === null).length,
      },
    };
  }
  const result = {
    browser: browserName,
    samples: samples.length,
    rpc: summary(
      samples.flatMap((s) =>
        s.rpc !== undefined && s.tap !== undefined ? [s.rpc - s.tap] : [],
      ),
    ),
    callerFirstFeedback: summary(
      times(["firstFeedback"], "paint").filter((v) => v !== null),
    ),
    callerPaint: summary(times(["caller"], "paint").filter((v) => v !== null)),
    lastRemoteReceipt: paired(
      times(
        remotes.map((role) => role + ":changes"),
        "receipt",
      ),
      times(
        remotes.map((role) => role + ":broadcast"),
        "receipt",
      ),
    ),
    lastScreenPaint: paired(
      times(["caller", ...remotes.map((role) => role + "Baseline")], "paint"),
      times(["caller", ...remotes], "paint"),
    ),
    byRecipient: Object.fromEntries(
      remotes.map((role) => [
        role,
        {
          receipt: paired(
            times([role + ":changes"], "receipt"),
            times([role + ":broadcast"], "receipt"),
          ),
          paint: paired(
            times([role + "Baseline"], "paint"),
            times([role], "paint"),
          ),
        },
      ]),
    ),
  };
  console.log(JSON.stringify(result, null, 2));
  await testInfo.attach("paired-buzz-timings", {
    body: JSON.stringify({ result, samples }, null, 2),
    contentType: "application/json",
  });
  await Promise.all(Object.values(pages).map((page) => page.context().close()));
  expect(result.lastRemoteReceipt.pairedImprovement.n).toBeGreaterThan(0);
});
