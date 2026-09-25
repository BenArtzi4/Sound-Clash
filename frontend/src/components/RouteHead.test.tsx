import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { pageFor } from "../lib/routeHead";
import { RouteHead } from "./RouteHead";

function Navigator() {
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate("/join")}>go join</button>
      <button onClick={() => navigate("/team/ABCDEF")}>go team</button>
    </div>
  );
}

function canonical(): string | null {
  return document.head.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null;
}

describe("RouteHead", () => {
  it("renders nothing", () => {
    const { container } = render(
      <MemoryRouter>
        <RouteHead />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("applies the head on mount and on every navigation", () => {
    render(
      <MemoryRouter initialEntries={["/how-to-play"]}>
        <RouteHead />
        <Navigator />
      </MemoryRouter>,
    );
    expect(document.title).toBe(pageFor("/how-to-play")?.title);
    expect(canonical()).toBe("https://www.soundclash.org/how-to-play");

    fireEvent.click(screen.getByText("go join"));
    expect(document.title).toBe(pageFor("/join")?.title);
    expect(canonical()).toBe("https://www.soundclash.org/join");

    fireEvent.click(screen.getByText("go team"));
    expect(document.title).toBe("Sound Clash");
    expect(canonical()).toBe("https://www.soundclash.org/");
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });
});
