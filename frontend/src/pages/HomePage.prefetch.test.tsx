import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

// Home fetches the pages its cards lead to while it sits idle, so a tap never
// waits on a download. Each mock factory runs only when its module is really
// imported, which is what this records.
const loaded = vi.hoisted(() => new Set<string>());
vi.mock("./ManagerCreateGamePage", () => {
  loaded.add("host");
  return { ManagerCreateGamePage: () => null };
});
vi.mock("./DisplayPage", () => {
  loaded.add("display");
  return { DisplayPage: () => null };
});
vi.mock("./HowToPlayPage", () => {
  loaded.add("how to play");
  return { HowToPlayPage: () => null };
});

describe("HomePage prefetch", () => {
  it("loads the Host, Display and How to play pages in the background", async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await waitFor(() => expect([...loaded].sort()).toEqual(["display", "host", "how to play"]), {
      timeout: 4000,
    });
  });
});
