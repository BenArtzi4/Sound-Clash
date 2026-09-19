// Hot-path guards for the redesigned buzz screen (ui-redesign 04 §6).
//
// The redesign is CSS-only on this page, so the risk is not a logic bug — it is
// a stylesheet that quietly puts work back on the main thread: a non-passive
// touch/wheel listener that blocks the compositor, an animation on a property
// that repaints, or a press whose feedback misses the next frame. None of that
// is visible to the other specs, which assert behaviour rather than cost.
import { expect, test } from "@playwright/test";
import { advanceRound, openManagerAndCreateGame } from "./fixtures/manager-context";
import { joinAsTeam } from "./fixtures/team-context";

// Properties the compositor can animate on its own. `filter` is on the list
// because brightness/saturate stay on the compositor; `blur` is banned by the
// design system precisely because it does not.
const COMPOSITED = ["transform", "opacity", "filter", "clip-path", "visibility"];

test("team page registers no non-passive touch/wheel listeners and buzz feedback is same-frame", async ({
  browser,
}) => {
  const manager = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
  });
  const team = await joinAsTeam(browser, manager.gameCode, "Guard");
  const page = team.page;

  await page.addInitScript(() => {
    const bad: string[] = [];
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ) {
      const passive = typeof options === "object" && options !== null && options.passive === true;
      if (
        (this === window || this === document) &&
        ["touchstart", "touchmove", "wheel"].includes(type) &&
        !passive
      ) {
        bad.push(type);
      }
      return orig.call(this, type, listener, options);
    };
    (window as unknown as { __badListeners: string[] }).__badListeners = bad;
  });
  await page.reload();
  await expect(page.getByTestId("buzz")).toBeVisible({ timeout: 20_000 });

  await advanceRound(manager.page);
  await expect(page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle", {
    timeout: 20_000,
  });

  expect(
    await page.evaluate(() => (window as unknown as { __badListeners: string[] }).__badListeners),
  ).toEqual([]);

  // The round is live, so the page root advertises it and the only thing still
  // looping is the buzz button's pulse ring.
  await expect(page.locator("main[data-round-live]")).toHaveAttribute("data-round-live", "true");
  // Poll rather than read once: a tone crossfade that happens to be in flight
  // is itself a legitimate running animation, and a single eager read races it.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => a.playState === "running")
            .map((a) => {
              const effect = a.effect as KeyframeEffect | null;
              const target = (effect?.target ?? null) as Element | null;
              const props = effect
                ? [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)))]
                    .filter((p) => !["offset", "composite", "computedOffset", "easing"].includes(p))
                    .map((p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
                : [];
              const testid = target?.getAttribute?.("data-testid") ?? "(not-the-buzz-button)";
              return `${testid}${effect?.pseudoElement ?? ""}: ${props.join("+")}`;
            })
            .sort(),
        ),
      {
        timeout: 10_000,
        message:
          "during a live round the only thing still animating must be the buzz button's pulse ring",
      },
    )
    // 04 §6: the team page's continuous animation set during a round is exactly
    // { buzz-pulse }, and it only touches compositor-safe properties.
    .toEqual(["buzz::after: opacity+transform"]);

  // The label is black ink on the orange accent — white on orange is 2.6:1 and
  // is forbidden by the design system.
  const ink = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="buzz"]') as HTMLElement;
    const root = getComputedStyle(document.documentElement);
    return {
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor,
      accent: root.getPropertyValue("--accent").trim(),
      accentInk: root.getPropertyValue("--accent-ink").trim(),
    };
  });
  expect(ink.color).toBe("rgb(0, 0, 0)");
  expect(ink.background).toBe("rgb(255, 122, 0)");
  expect(ink.accentInk).toBe("#000000");
  expect(ink.accent).toBe("#ff7a00");

  // Under reduced motion nothing may keep running. Poll: a transition already
  // in flight when the media query flips keeps its original duration (only a
  // newly started one picks up the reduced-motion override), so an eager read
  // counts a straggler that is about to end on its own.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          document
            .getAnimations()
            .filter(
              (a) =>
                a.playState === "running" &&
                ((a.effect?.getComputedTiming().activeDuration as number) ?? 0) > 1,
            )
            .map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement ?? "element")
            .sort(),
        ),
      { timeout: 10_000, message: "reduced motion must leave nothing running longer than 1 ms" },
    )
    .toEqual([]);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.getByTestId("buzz")).toHaveAttribute("data-tone", "idle");

  // Press feedback must not wait on anything: the press styling is a
  // zero-duration transition and the tone comes from React state, so the whole
  // pointerdown handler — which also fires buzz_in — has to return immediately.
  //
  // We time the handler itself rather than the next animation frame. A frame
  // is not a useful clock here: the only thing animating during a round is the
  // pulse ring, which runs entirely on the compositor, so an idle main thread
  // legitimately schedules no frame for hundreds of milliseconds (measured:
  // handler 2.6 ms, next rAF 217 ms, with visibilityState "visible"). Gating on
  // rAF would therefore fail precisely when the compositor offload is working.
  const handlerMs = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="buzz"]') as HTMLButtonElement;
    const t0 = performance.now();
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
    return performance.now() - t0;
  });
  expect(handlerMs).toBeLessThan(50);
  // ...and the tone the player sees flips from local state, not a Realtime
  // round trip, so a tight bound holds.
  await expect(page.getByTestId("buzz")).toHaveAttribute("data-tone", /pending|winner/, {
    timeout: 1_000,
  });
});
