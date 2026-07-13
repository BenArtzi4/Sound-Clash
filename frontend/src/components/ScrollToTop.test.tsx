import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollToTop } from "./ScrollToTop";

// Buttons that drive client-side navigation, so we exercise the same
// route-change path <Link> uses in the real app.
function Navigator() {
  const navigate = useNavigate();
  return (
    <div>
      <button onClick={() => navigate("/how-to-play")}>go how-to-play</button>
      <button onClick={() => navigate("/join/ABCDEF")}>go join</button>
      <button onClick={() => navigate("/join/ABCDEF#rt=token")}>go hashed</button>
      <button onClick={() => navigate("/how-to-play")}>go same path</button>
      <button onClick={() => navigate("/how-to-play?x=1")}>go search</button>
    </div>
  );
}

let scrollSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  scrollSpy.mockRestore();
});

describe("ScrollToTop", () => {
  it("renders nothing", () => {
    const { container } = render(
      <MemoryRouter>
        <ScrollToTop />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("scrolls to the top when the pathname changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ScrollToTop />
        <Navigator />
      </MemoryRouter>,
    );
    // Ignore the mount-time call; assert on the navigation itself.
    scrollSpy.mockClear();

    fireEvent.click(screen.getByText("go how-to-play"));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith(0, 0);
  });

  it("does not scroll when the destination URL carries a hash fragment", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ScrollToTop />
        <Navigator />
      </MemoryRouter>,
    );
    scrollSpy.mockClear();

    // A #rt= token (or any future in-page #anchor) must not yank the viewport.
    fireEvent.click(screen.getByText("go hashed"));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("scrolls on every distinct-path navigation", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ScrollToTop />
        <Navigator />
      </MemoryRouter>,
    );
    scrollSpy.mockClear();

    fireEvent.click(screen.getByText("go how-to-play"));
    fireEvent.click(screen.getByText("go join"));

    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  it("does not scroll when re-navigating to the current pathname", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ScrollToTop />
        <Navigator />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("go how-to-play"));
    scrollSpy.mockClear();

    // Same pathname, same (empty) hash → the deps array is unchanged, so the
    // effect must not re-fire and yank the viewport.
    fireEvent.click(screen.getByText("go same path"));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("does not scroll when only the search query changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ScrollToTop />
        <Navigator />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("go how-to-play"));
    scrollSpy.mockClear();

    // Search params are deliberately not in the deps: a page updating its own
    // query string (filter/sort/paginate) must never scroll the user to top.
    fireEvent.click(screen.getByText("go search"));

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
