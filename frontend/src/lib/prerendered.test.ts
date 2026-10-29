import { describe, expect, it } from "vitest";
import { isPrerenderedFor } from "./prerendered";

function root(prerendered?: string, html = "<div>page</div>"): HTMLElement {
  const el = document.createElement("div");
  if (prerendered !== undefined) el.dataset.prerendered = prerendered;
  el.innerHTML = html;
  return el;
}

describe("isPrerenderedFor", () => {
  it("hydrates markup at the path it was rendered for", () => {
    expect(isPrerenderedFor(root("/"), "/")).toBe(true);
    expect(isPrerenderedFor(root("/how-to-play"), "/how-to-play")).toBe(true);
  });

  it("ignores a trailing slash", () => {
    expect(isPrerenderedFor(root("/how-to-play"), "/how-to-play/")).toBe(true);
    expect(isPrerenderedFor(root("/"), "//")).toBe(true);
  });

  it("refuses another page's markup (vite preview serves index.html everywhere)", () => {
    expect(isPrerenderedFor(root("/"), "/join/ABCDEF")).toBe(false);
    expect(isPrerenderedFor(root("/how-to-play"), "/")).toBe(false);
  });

  it("renders fresh when the root is the empty SPA shell", () => {
    expect(isPrerenderedFor(root(undefined, ""), "/")).toBe(false);
    expect(isPrerenderedFor(root(undefined), "/")).toBe(false);
    expect(isPrerenderedFor(root("/", ""), "/")).toBe(false);
  });
});
