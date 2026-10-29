import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const funnel = vi.hoisted(() => ({ trackRoute: vi.fn() }));
vi.mock("../lib/funnel", () => funnel);

import { ViewTracker } from "./ViewTracker";

describe("ViewTracker", () => {
  it("reports each route the visitor reaches, once per change", async () => {
    const router = createMemoryRouter([{ path: "*", element: <ViewTracker /> }], {
      initialEntries: ["/"],
    });
    render(<RouterProvider router={router} />);
    expect(funnel.trackRoute).toHaveBeenLastCalledWith("/");

    await act(() => router.navigate("/manager/create"));
    expect(funnel.trackRoute).toHaveBeenLastCalledWith("/manager/create");
    const calls = funnel.trackRoute.mock.calls.length;

    await act(() => router.navigate("/manager/create#top"));
    expect(funnel.trackRoute).toHaveBeenCalledTimes(calls);
  });
});
