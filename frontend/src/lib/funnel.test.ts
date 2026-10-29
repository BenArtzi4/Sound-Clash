import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tele = vi.hoisted(() => ({ trackEvent: vi.fn(), trackView: vi.fn() }));
vi.mock("./telemetry", () => tele);

import {
  _resetFunnel,
  captureLanding,
  getLanding,
  joinSource,
  trackCta,
  trackGameCreated,
  trackRoute,
  trackTeamJoined,
  viewName,
} from "./funnel";

function visit(pathAndQuery: string, referrer = "") {
  window.history.replaceState(null, "", pathAndQuery);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

beforeEach(() => {
  _resetFunnel();
  tele.trackEvent.mockClear();
  tele.trackView.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  visit("/");
});

describe("viewName", () => {
  it("keeps game codes out of the route", () => {
    expect(viewName("/join/ABCDEF")).toBe("/join/*");
    expect(viewName("/team/ABCDEF")).toBe("/team/*");
    expect(viewName("/display/ABCDEF")).toBe("/display/*");
    expect(viewName("/manager/game/ABCDEF")).toBe("/manager/game/*");
  });

  it("names the fixed pages and lumps everything else together", () => {
    expect(viewName("/")).toBe("/");
    expect(viewName("/how-to-play/")).toBe("/how-to-play");
    expect(viewName("/manager/create")).toBe("/manager/create");
    expect(viewName("/hitster-alternative")).toBe("/hitster-alternative");
    expect(viewName("/wp-login.php")).toBe("/other");
  });
});

describe("captureLanding", () => {
  it("records the source of a QR scan and cleans the address bar", () => {
    visit("/join/ABCDEF?qr&cb=7#rt=token", "https://l.instagram.com/?u=x");
    const replace = vi.spyOn(window.history, "replaceState");
    captureLanding();

    expect(tele.trackEvent).toHaveBeenCalledWith("landing", {
      view: "/join/*",
      ref_host: "l.instagram.com",
      ref: "",
      src: "qr",
      utm_source: "",
      utm_medium: "",
      utm_campaign: "",
      utm_content: "",
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/join/ABCDEF");
    expect(window.location.search).toBe("?cb=7");
    expect(window.location.hash).toBe("#rt=token");
    replace.mockRestore();
  });

  it("keeps launch tags short and plain, and ignores this site as a referrer", () => {
    visit(
      "/?ref=Play My Game!!&utm_source=Reddit&utm_campaign=launch",
      `${window.location.origin}/how-to-play`,
    );
    captureLanding();
    expect(tele.trackEvent).toHaveBeenCalledWith(
      "landing",
      expect.objectContaining({
        view: "/",
        ref_host: "",
        ref: "play_my_game_",
        utm_source: "reddit",
        utm_campaign: "launch",
      }),
    );
    expect(window.location.search).toBe("");
  });

  it("leaves a plain URL alone and runs once per page load", () => {
    visit("/how-to-play");
    const replace = vi.spyOn(window.history, "replaceState");
    captureLanding();
    captureLanding();
    expect(replace).not.toHaveBeenCalled();
    expect(tele.trackEvent).toHaveBeenCalledTimes(1);
    expect(getLanding()?.view).toBe("/how-to-play");
    replace.mockRestore();
  });

  it("does not break the page on an unreadable referrer", () => {
    visit("/", "not a url");
    expect(() => captureLanding()).not.toThrow();
    expect(getLanding()?.refHost).toBe("");
  });
});

describe("joinSource", () => {
  it("is qr only when the visit started from the Display's QR", () => {
    visit("/join/ABCDEF?qr");
    captureLanding();
    expect(joinSource(true)).toBe("qr");
  });

  it("tells a shared link from a typed code", () => {
    visit("/join/ABCDEF");
    captureLanding();
    expect(joinSource(true)).toBe("link");
    expect(joinSource(false)).toBe("typed");
  });

  it("sends the source with the join", () => {
    visit("/join");
    captureLanding();
    trackTeamJoined(false);
    expect(tele.trackEvent).toHaveBeenLastCalledWith("team_joined", { source: "typed" });
  });
});

describe("events", () => {
  it("names the route and the click", () => {
    trackRoute("/team/ABCDEF");
    expect(tele.trackView).toHaveBeenCalledWith("/team/*");
    trackCta("home_host");
    expect(tele.trackEvent).toHaveBeenCalledWith("cta", { id: "home_host" });
  });

  it("marks a browser that created a game before as returning", () => {
    trackGameCreated(3, 0);
    trackGameCreated(1, 2);
    expect(tele.trackEvent.mock.calls).toEqual([
      ["game_created", { genres_count: 3, decades_count: 0, returning: false }],
      ["game_created", { genres_count: 1, decades_count: 2, returning: true }],
    ]);
  });

  it("still counts the game when storage is blocked", () => {
    // Storage methods live on its prototype; an own property would just be stored.
    const proto = Object.getPrototypeOf(window.localStorage) as {
      getItem: (key: string) => string | null;
    };
    const get = vi.spyOn(proto, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    trackGameCreated(2, 0);
    expect(tele.trackEvent).toHaveBeenCalledWith("game_created", {
      genres_count: 2,
      decades_count: 0,
      returning: undefined,
    });
    get.mockRestore();
  });
});
