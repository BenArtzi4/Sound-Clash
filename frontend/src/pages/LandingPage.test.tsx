import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { seo } from "../lib/routeHead";
import { LANDING_CONTENT } from "../seo/landingContent";
import { LandingPage } from "./LandingPage";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LandingPage path={path} />
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  it.each(LANDING_CONTENT.map((p) => [p.path, p] as const))("renders %s", (path, page) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(page.h1);
    for (const section of page.sections) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(page.faq.length);
    expect(screen.getByRole("heading", { level: 2, name: page.closing })).toBeInTheDocument();
  });

  it("sends readers to host, join and the rules", () => {
    renderAt("/music-trivia-night");
    const hosts = screen.getAllByRole("link", { name: /host a (free )?game/i });
    expect(hosts.map((a) => a.getAttribute("href"))).toEqual([
      "/manager/create",
      "/manager/create",
    ]);
    expect(screen.getByRole("link", { name: /join with a code/i })).toHaveAttribute(
      "href",
      "/join",
    );
    expect(screen.getByRole("link", { name: /^how to play$/i })).toHaveAttribute(
      "href",
      "/how-to-play",
    );
    expect(screen.getByRole("link", { name: /sound clash home/i })).toHaveAttribute("href", "/");
  });

  it("renders steps as a numbered list and bullets as a plain one", () => {
    renderAt("/music-trivia-buzzer-game");
    const page = LANDING_CONTENT.find((p) => p.path === "/music-trivia-buzzer-game");
    const stepped = page?.sections.find((s) => s.steps);
    const section = screen.getByRole("heading", { level: 2, name: stepped?.heading }).parentElement;
    const list = within(section as HTMLElement).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(stepped?.steps?.length ?? -1);
  });

  it("links the other content pages from its footer, not itself", () => {
    renderAt("/soundtrack-quiz");
    const footer = screen.getByRole("navigation", { name: /sound clash pages/i });
    const hrefs = within(footer)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/soundtrack-quiz");
    expect(hrefs).toEqual(
      seo.pages.filter((p) => p.nav && p.path !== "/soundtrack-quiz").map((p) => p.path),
    );
  });
});
