import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    code: string;
    status: number;
    details: unknown;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
      this.details = undefined;
    }
  },
  joinTeam: vi.fn(),
}));

import { ApiError, joinTeam } from "../lib/api";
import { JoinTeamPage } from "./JoinTeamPage";

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(joinTeam).mockReset();
});

afterEach(() => {
  window.localStorage.clear();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join" element={<JoinTeamPage />} />
        <Route path="/join/:gameCode" element={<JoinTeamPage />} />
        <Route path="/team/:gameCode" element={<div>team page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JoinTeamPage", () => {
  it("disables submit when fields are empty", () => {
    renderAt("/join");
    const submit = screen.getByRole("button", { name: /join game/i });
    expect(submit).toBeDisabled();
  });

  it("pre-fills the code from the URL parameter", () => {
    renderAt("/join/abcdef");
    expect(screen.getByLabelText(/game code/i)).toHaveValue("ABCDEF");
  });

  it("submits and writes localStorage on success", async () => {
    vi.mocked(joinTeam).mockResolvedValueOnce({
      id: "t1",
      game_code: "ABCDEF",
      name: "Alice",
      score: 0,
      joined_at: "2026-05-05T12:00:00Z",
    });
    renderAt("/join/ABCDEF");
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join game/i }));
    await waitFor(() => {
      expect(joinTeam).toHaveBeenCalledWith("ABCDEF", "Alice");
    });
    expect(JSON.parse(window.localStorage.getItem("game:ABCDEF:team") ?? "{}")).toEqual({
      id: "t1",
      name: "Alice",
    });
  });

  it("shows a friendly message on 404", async () => {
    vi.mocked(joinTeam).mockRejectedValueOnce(new ApiError("not_found", "no", 404));
    renderAt("/join/ABCDEF");
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join game/i }));
    await waitFor(() => expect(screen.getByText(/does not exist/i)).toBeInTheDocument());
  });

  it("shows a friendly message on 410 ended", async () => {
    vi.mocked(joinTeam).mockRejectedValueOnce(new ApiError("gone", "ended", 410));
    renderAt("/join/ABCDEF");
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join game/i }));
    await waitFor(() => expect(screen.getByText(/already ended/i)).toBeInTheDocument());
  });

  it("shows a friendly message on 409 conflict", async () => {
    vi.mocked(joinTeam).mockRejectedValueOnce(new ApiError("conflict", "taken", 409));
    renderAt("/join/ABCDEF");
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join game/i }));
    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
  });

  it("strips invalid characters from the game-code input as the user types", () => {
    renderAt("/join");
    const codeInput = screen.getByLabelText(/game code/i);
    fireEvent.change(codeInput, { target: { value: "ab1c0d!ef" } });
    expect(codeInput).toHaveValue("ABCDEF");
  });

  it("shows a generic error on non-ApiError failures", async () => {
    vi.mocked(joinTeam).mockRejectedValueOnce(new Error("boom"));
    renderAt("/join/ABCDEF");
    fireEvent.change(screen.getByLabelText(/team name/i), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByRole("button", { name: /join game/i }));
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
  });
});
