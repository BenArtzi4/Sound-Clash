import { devices, expect, test } from "@playwright/test";
import {
  advanceRound,
  openManagerAndCreateGame,
} from "./fixtures/manager-context";

test("a preview miss on Start and Next leaves the current song playable from a fresh tap", async ({
  browser,
  isMobile,
}) => {
  const latePeek = Promise.withResolvers<void>();
  let peeks = 0;
  const advances: Array<string | null> = [];
  const { page } = await openManagerAndCreateGame(browser, {
    genreName: "Rock",
    contextOptions: {
      ...(isMobile ? devices["iPhone SE"] : undefined),
      reducedMotion: "reduce",
    },
    preparePage: async (host) => {
      await host.route("**/rpc/peek_next_song", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        peeks += 1;
        if (peeks === 1) {
          await latePeek.promise;
          return route.continue();
        }
        await route.fulfill({ json: [] });
      });
      await host.route("**/rpc/select_next_song", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        advances.push(route.request().postDataJSON().p_song_id);
        // Let Realtime arrive before the round response and outlast the tap.
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 150));
        await route.fulfill({ response });
      });
      await host.route("https://www.youtube-nocookie.com/embed/**", (route) =>
        route.fulfill(),
      );
      await host.addInitScript(() => {
        let inTap = false;
        window.addEventListener(
          "click",
          () => {
            inTap = true;
            window.setTimeout(() => {
              inTap = false;
            }, 0);
          },
          true,
        );
        Object.assign(window, {
          YT: {
            Player: class {
              private state = -1;
              constructor(
                private iframe: HTMLIFrameElement,
                private config: {
                  events: {
                    onReady: () => void;
                    onAutoplayBlocked: () => void;
                    onStateChange: (event: { data: number }) => void;
                  };
                },
              ) {
                queueMicrotask(config.events.onReady);
              }
              loadVideoById(song: { videoId: string; startSeconds: number }) {
                this.iframe.dataset.requestedSong = JSON.stringify(song);
                this.iframe.dataset.inTap = String(inTap);
                this.iframe.dataset.loads = String(
                  Number(this.iframe.dataset.loads ?? 0) + 1,
                );
                this.state = inTap ? 1 : -1;
                if (inTap) this.config.events.onStateChange({ data: 1 });
                else this.config.events.onAutoplayBlocked();
              }
              getPlayerState() {
                return this.state;
              }
              destroy() {}
              unMute() {}
            },
          },
        });
      });
    },
  });
  await expect.poll(() => peeks).toBe(1);
  const frame = page.getByTestId("youtube-player").locator("iframe");
  const play = page.getByRole("button", { name: "Play song", exact: true });

  for (const round of [1, 2]) {
    const result = page.waitForResponse(
      (response) =>
        response.url().endsWith("/rpc/select_next_song") &&
        response.request().method() === "POST",
    );
    await advanceRound(page);
    const [song] = await (await result).json();
    const sameSong = JSON.stringify({
      videoId: song.youtube_id,
      startSeconds: song.start_time,
    });
    await expect(play).toBeEnabled();
    await expect(page.getByTestId("start-round")).toBeEnabled();
    await expect(frame).toHaveAttribute("data-loads", String(round * 2 - 1));
    await expect(frame).toHaveAttribute("data-in-tap", "false");
    await expect(frame).toHaveAttribute("data-requested-song", sameSong);
    await play.click();
    await expect(
      page.getByRole("button", { name: "Pause the song" }),
    ).toBeEnabled();
    await expect(frame).toHaveAttribute("data-loads", String(round * 2));
    await expect(frame).toHaveAttribute("data-in-tap", "true");
    await expect(frame).toHaveAttribute("data-requested-song", sameSong);
    await expect(
      page.getByText(new RegExp("Round " + round + "$", "i")),
    ).toBeVisible();
    expect(advances).toEqual(Array(round).fill(null));

    if (round === 1) {
      latePeek.resolve();
      await expect.poll(() => peeks).toBe(2);
    }
  }
});
