import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransitionLink } from "./TransitionLink";

afterEach(() => {
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
});

function renderLink(node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={node} />
        <Route path="/join" element={<p>joined</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TransitionLink", () => {
  it("renders a real link and navigates on click", async () => {
    renderLink(<TransitionLink to="/join">Play</TransitionLink>);
    const link = screen.getByRole("link", { name: "Play" });
    expect(link).toHaveAttribute("href", "/join");
    await userEvent.click(link);
    // findByText, not getByText: TransitionLink fires `void go(...)`, which
    // awaits the preload before navigating, so the route commits in a later
    // microtask than the click. A synchronous assertion races it and flakes
    // only under load.
    expect(await screen.findByText("joined")).toBeInTheDocument();
  });

  it("awaits the preload before navigating", async () => {
    const preload = vi.fn().mockResolvedValue(undefined);
    renderLink(
      <TransitionLink to="/join" preload={preload}>
        Play
      </TransitionLink>,
    );
    await userEvent.click(screen.getByRole("link", { name: "Play" }));
    expect(preload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("joined")).toBeInTheDocument();
  });

  it("calls the caller's onClick and honours preventDefault", async () => {
    const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault());
    renderLink(
      <TransitionLink to="/join" onClick={onClick}>
        Play
      </TransitionLink>,
    );
    await userEvent.click(screen.getByRole("link", { name: "Play" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    // preventDefault in the caller's handler stops both the transition and the
    // router's own navigation.
    expect(screen.queryByText("joined")).not.toBeInTheDocument();
  });

  it.each([
    ["a meta-click (open in a new tab)", { metaKey: true }],
    ["a ctrl-click", { ctrlKey: true }],
    ["a shift-click", { shiftKey: true }],
    ["an alt-click", { altKey: true }],
    ["a middle click", { button: 1 }],
  ])("leaves %s to the browser", (_label, init) => {
    const vt = vi.fn();
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vt;
    renderLink(<TransitionLink to="/join">Play</TransitionLink>);
    fireEvent.click(screen.getByRole("link", { name: "Play" }), init);
    // The hook never runs, so the anchor's own href does the work: middle-click
    // opens a tab and the modified clicks keep their native meaning.
    expect(vt).not.toHaveBeenCalled();
  });

  it("keeps extra props such as className on the anchor", () => {
    renderLink(
      <TransitionLink to="/join" className="btn btn-ghost" aria-label="Cancel">
        Cancel
      </TransitionLink>,
    );
    const link = screen.getByRole("link", { name: "Cancel" });
    expect(link).toHaveClass("btn", "btn-ghost");
  });
});
