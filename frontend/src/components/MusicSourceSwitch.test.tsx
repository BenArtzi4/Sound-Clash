import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  MUSIC_SOURCE_TABS,
  MusicSourceSwitch,
  type MusicSource,
  type MusicSourceTab,
} from "./MusicSourceSwitch";

// The address decides the tab, as on the Host page: no source is Genres.
function Page({ tabs }: { tabs: readonly MusicSourceTab[] }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const open = tabs.find((t) => t.to === location.pathname)?.id ?? "genres";
  return (
    <>
      <MusicSourceSwitch tabs={tabs} active={open as MusicSource} panelId="panel" />
      <p data-testid="where">{location.pathname + location.search}</p>
      <p data-testid="how">{navigationType}</p>
    </>
  );
}

function renderSwitch(entry = "/manager/create", tabs = MUSIC_SOURCE_TABS) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/manager/create/:source?" element={<Page tabs={tabs} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function slider(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[aria-hidden="true"][data-n]');
  if (!el) throw new Error("no sliding copy");
  return el;
}

describe("MusicSourceSwitch", () => {
  it("draws one tab for each entry and marks the open one", () => {
    const { container } = renderSwitch("/manager/create/list");
    expect(MUSIC_SOURCE_TABS.map((t) => [t.id, t.label, t.to])).toEqual([
      ["genres", "Genres", "/manager/create"],
      ["list", "My own list", "/manager/create/list"],
    ]);

    const tablist = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Genres", "My own list"]);
    expect(tablist).toContainElement(tabs[0] ?? null);

    const genres = screen.getByTestId("music-source-genres");
    const list = screen.getByTestId("music-source-list");
    expect(genres).toHaveAttribute("aria-selected", "false");
    expect(list).toHaveAttribute("aria-selected", "true");
    // Only the open tab is in the tab order, and it controls the panel.
    expect(genres).toHaveAttribute("tabindex", "-1");
    expect(list).toHaveAttribute("tabindex", "0");
    expect(list).toHaveAttribute("aria-controls", "panel");
    expect(list).toHaveAttribute("id", "panel-list");

    // The light copy of the labels, clipped to the open tab.
    const copy = slider(container);
    expect(copy).toHaveAttribute("data-n", "2");
    expect(copy).toHaveAttribute("data-i", "1");
    expect(copy).toHaveTextContent("GenresMy own list");
  });

  it("counts three tabs when it is given three", () => {
    const three: readonly MusicSourceTab[] = [
      ...MUSIC_SOURCE_TABS,
      { id: "artists", label: "Pick artists", to: "/manager/create/artists" },
    ];
    const { container } = renderSwitch("/manager/create/artists", three);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(slider(container)).toHaveAttribute("data-n", "3");
    expect(slider(container)).toHaveAttribute("data-i", "2");
  });

  it("opens the next tab with the arrow keys, and wraps", async () => {
    const { container } = renderSwitch();
    const genres = screen.getByTestId("music-source-genres");
    const list = screen.getByTestId("music-source-list");
    genres.focus();

    fireEvent.keyDown(genres, { key: "ArrowRight" });
    expect(await screen.findByText("/manager/create/list")).toBeInTheDocument();
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-selected", "true");
    expect(slider(container)).toHaveAttribute("data-i", "1");
    // A tab change replaces the address, so Back leaves the Host page.
    expect(screen.getByTestId("how")).toHaveTextContent("REPLACE");

    // Past the last tab: back to the first.
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(await screen.findByText("/manager/create")).toBeInTheDocument();
    expect(genres).toHaveFocus();

    // Before the first tab: on to the last.
    fireEvent.keyDown(genres, { key: "ArrowLeft" });
    expect(await screen.findByText("/manager/create/list")).toBeInTheDocument();
    expect(list).toHaveFocus();

    // Other keys do nothing.
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(screen.getByTestId("where")).toHaveTextContent("/manager/create/list");
  });

  it("keeps the query string in each tab's link", async () => {
    renderSwitch("/manager/create?test=1");
    expect(screen.getByTestId("music-source-genres")).toHaveAttribute(
      "href",
      "/manager/create?test=1",
    );
    expect(screen.getByTestId("music-source-list")).toHaveAttribute(
      "href",
      "/manager/create/list?test=1",
    );

    fireEvent.click(screen.getByTestId("music-source-list"));
    expect(await screen.findByText("/manager/create/list?test=1")).toBeInTheDocument();
    expect(screen.getByTestId("how")).toHaveTextContent("REPLACE");
    fireEvent.keyDown(screen.getByTestId("music-source-list"), { key: "ArrowLeft" });
    expect(await screen.findByText("/manager/create?test=1")).toBeInTheDocument();
  });
});
