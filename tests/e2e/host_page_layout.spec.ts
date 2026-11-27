// The top of the Host page on the smallest phone we design for (320 x 568),
// host-music-choices.md sections 7 and 9 (Custom Setlist phase 1, Task 10).
//
// These are layout promises a unit test cannot see (jsdom has no layout): the
// lines that must stay on one line, the two columns of genre tiles, Quick
// start's row that shows it slides, a tap on a mix that must not move that
// row, and the My own list address surviving a reload. Every check measures
// the rendered page and waits on content (a tile, an attribute, a scroll
// position), never on a fixed time.
import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 } });

// The Host page with its genres loaded (Quick start shows only then).
async function openHostPage(page: Page): Promise<void> {
  await page.goto("/manager/create");
  await expect(page.getByRole("button", { name: "Everything", exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

// Quick start's sideways row: the parent of its mixes.
function presetRow(page: Page): Locator {
  return page.getByRole("button", { name: "Everything", exact: true }).locator("xpath=..");
}

const scrollLeftOf = (row: Locator) => row.evaluate((el) => el.scrollLeft);

// Waits until the row has stopped moving (a smooth scroll, then its snap).
async function settledScrollLeft(row: Locator): Promise<number> {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const now = await scrollLeftOf(row);
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return last;
}

// Resolves after n animation frames, so a scroll that a tap set off has begun.
async function frames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

// Lines of text in an element (one rect per line box), and whether it overflows.
function measureLines(el: Element): { lines: number; overflows: boolean; text: string } {
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = new Set(
    [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
  );
  return {
    lines: tops.size,
    overflows: el.scrollWidth > el.clientWidth,
    text: el.textContent ?? "",
  };
}

test("the fixed line and each switch label stay on one line", async ({ page }) => {
  await openHostPage(page);
  const targets = [
    page.getByText("Choose how to pick the songs", { exact: true }),
    page.getByTestId("music-source-genres"),
    page.getByTestId("music-source-list"),
  ];
  for (const target of targets) {
    await expect(target).toBeVisible();
    const m = await target.evaluate(measureLines);
    expect(m, `"${m.text}" stays on one line`).toEqual({ lines: 1, overflows: false, text: m.text });
  }
  // Each switch label keeps its 44 px row.
  for (const id of ["music-source-genres", "music-source-list"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("genre tiles are in two columns and no name is cut", async ({ page }) => {
  await openHostPage(page);
  const tiles = await page.evaluate(() => {
    // The first ticked-box tile is the first genre; its grid holds them all
    // (the decades come later, in their own rows).
    const first = document.querySelector('label:has(> input[type="checkbox"])');
    return [...(first?.parentElement?.children ?? [])].map((tile) => {
      const box = tile.getBoundingClientRect();
      return {
        name: tile.textContent ?? "",
        top: Math.round(box.top),
        left: Math.round(box.left),
        cut: tile.scrollWidth > tile.clientWidth || tile.scrollHeight > tile.clientHeight,
      };
    });
  });
  expect(tiles.length).toBeGreaterThanOrEqual(3);
  const [one, two, three] = tiles;
  expect(two?.top, "tiles 1 and 2 share a line").toBe(one?.top);
  expect(two?.left ?? 0).toBeGreaterThan(one?.left ?? 0);
  expect(three?.top ?? 0, "tile 3 starts the next line").toBeGreaterThan(one?.top ?? 0);
  expect(three?.left, "tile 3 is under tile 1").toBe(one?.left);
  expect(tiles.filter((t) => t.cut).map((t) => t.name)).toEqual([]);
  // Nothing on the page is wider than the phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Quick start shows that it slides", async ({ page }) => {
  await openHostPage(page);
  await expect(page.getByTestId("quick-start-count")).toHaveText("6 mixes");
  const row = presetRow(page);
  const next = page.getByTestId("quick-start-next");
  const prev = page.getByTestId("quick-start-prev");

  // More mixes to the right only: the right arrow shows, the left one does not.
  await expect(next).toBeVisible();
  await expect(next).toHaveCSS("opacity", "1");
  await expect(prev).toBeHidden();
  expect(await scrollLeftOf(row)).toBe(0);

  // A tap moves the row by most of its width (70%, then the nearest snap).
  const width = await row.evaluate((el) => el.clientWidth);
  await next.click();
  await expect.poll(() => scrollLeftOf(row)).toBeGreaterThan(width * 0.5);
  const moved = await settledScrollLeft(row);
  expect(moved).toBeLessThanOrEqual(width);

  // The row has moved, so the left arrow shows now.
  await expect(prev).toBeVisible();
  await expect(prev).toHaveCSS("opacity", "1");
});

test("a tap on a mix does not move the row", async ({ page }) => {
  await openHostPage(page);
  const row = presetRow(page);

  // First move the row, as a host would, so mixes are cut at its edges.
  await page.getByTestId("quick-start-next").click();
  await expect.poll(() => scrollLeftOf(row)).toBeGreaterThan(0);
  await settledScrollLeft(row);

  // A mix that is partly off-screen, and a point on it that a tap reaches
  // (inside the row, not under an arrow). The fonts decide how wide that
  // strip is, so if this stop has none, try the row's other stops.
  const findSpot = () =>
    row.evaluate((el) => {
      const rowBox = el.getBoundingClientRect();
      for (const mix of el.children) {
        const box = mix.getBoundingClientRect();
        const whole = box.left >= rowBox.left - 1 && box.right <= rowBox.right + 1;
        if (whole || mix.getAttribute("aria-pressed") === "true") continue;
        const y = Math.round(box.top + box.height / 2);
        const from = Math.ceil(Math.max(box.left, rowBox.left));
        const to = Math.floor(Math.min(box.right, rowBox.right));
        const hits: number[] = [];
        for (let x = from; x < to; x++) {
          if (document.elementFromPoint(x, y) === mix) hits.push(x);
        }
        if (hits.length > 0) {
          return { name: mix.textContent ?? "", x: hits[Math.floor(hits.length / 2)] ?? from, y };
        }
      }
      return null;
    });
  let spot = await findSpot();
  const stops = await row.evaluate((el) =>
    [...el.children].map(
      (mix) => (mix as HTMLElement).offsetLeft - (el as HTMLElement).offsetLeft,
    ),
  );
  for (const stop of stops) {
    if (spot) break;
    await row.evaluate((el, left) => el.scrollTo({ left, behavior: "instant" }), stop);
    await settledScrollLeft(row);
    spot = await findSpot();
  }
  expect(spot, "a partly cut mix with a spot a tap reaches").not.toBeNull();
  if (!spot) return;

  const before = await settledScrollLeft(row);
  await page.mouse.click(spot.x, spot.y);
  // The tap reached the mix: it is picked.
  await expect(page.getByRole("button", { name: spot.name, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await frames(page, 10);
  expect(await scrollLeftOf(row)).toBe(before);
});

test("a reload on /manager/create/list opens My own list", async ({ page }) => {
  await openHostPage(page);
  await page.getByTestId("music-source-list").click();
  await expect(page).toHaveURL(/\/manager\/create\/list$/);
  await expect(page.getByTestId("setlist-input")).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/manager\/create\/list$/);
  await expect(page.getByTestId("music-source-list")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("setlist-input")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Everything", exact: true })).toHaveCount(0);
});
