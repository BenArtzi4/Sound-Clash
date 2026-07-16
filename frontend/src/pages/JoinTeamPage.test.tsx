import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  rejoinTeam: vi.fn(),
  getHealth: vi.fn(() => Promise.resolve({ status: "ok", version: "test", supabase: "ok" })),
}));

// The page prefetches the gameplay chunk on mount; stub it so the test doesn't
// pull in the real (heavy) module or its Supabase/YouTube side effects.
vi.mock("./TeamGameplayPage", () => ({ TeamGameplayPage: () => null }));

import { ApiError, getHealth, joinTeam, rejoinTeam } from "../lib/api";
import { JoinTeamPage } from "./JoinTeamPage";

const REJOIN_UUID = "b3b8c9d0-1234-4abc-9def-0123456789ab";

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(joinTeam).mockReset();
  vi.mocked(rejoinTeam).mockReset();
  vi.mocked(getHealth).mockClear();
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

  it("pre-warms the backend on mount", () => {
    renderAt("/join/ABCDEF");
    expect(getHealth).toHaveBeenCalledTimes(1);
  });

  it("adopts a #rt= rejoin token: reconnects and lands on gameplay", async () => {
    vi.mocked(rejoinTeam).mockResolvedValueOnce({
      id: "t1",
      game_code: "ABCDEF",
      name: "Alice",
      score: 37,
      joined_at: "2026-05-05T12:00:00Z",
    });
    renderAt(`/join/ABCDEF#rt=${REJOIN_UUID}`);
    await waitFor(() => {
      expect(rejoinTeam).toHaveBeenCalledWith("ABCDEF", REJOIN_UUID);
    });
    // Stores the normal {id,name} identity (so a later refresh auto-rejoins)
    // and navigates to the gameplay route.
    expect(JSON.parse(window.localStorage.getItem("game:ABCDEF:team") ?? "{}")).toEqual({
      id: "t1",
      name: "Alice",
    });
    await waitFor(() => expect(screen.getByText("team page")).toBeInTheDocument());
    // Never falls back to a manual join for a valid link.
    expect(joinTeam).not.toHaveBeenCalled();
  });

  it("falls back to the manual form when a #rt= rejoin link is invalid", async () => {
    vi.mocked(rejoinTeam).mockRejectedValueOnce(new ApiError("not_found", "no", 404));
    renderAt(`/join/ABCDEF#rt=${REJOIN_UUID}`);
    await waitFor(() => expect(screen.getByText(/didn't work/i)).toBeInTheDocument());
    // The join form is back so the player can re-enter their name (path B).
    expect(screen.getByLabelText(/game code/i)).toBeInTheDocument();
  });

  it("rejects a #rt= link with no game code and never calls rejoin", async () => {
    renderAt(`/join#rt=${REJOIN_UUID}`);
    await waitFor(() => expect(screen.getByText(/missing a valid game code/i)).toBeInTheDocument());
    expect(rejoinTeam).not.toHaveBeenCalled();
  });

  it("shows a spinner and swaps the label as a pending join gets slow", () => {
    vi.useFakeTimers();
    try {
      // A join that never settles, so the slow-pending timers can fire.
      vi.mocked(joinTeam).mockReturnValueOnce(new Promise(() => {}));
      renderAt("/join/ABCDEF");
      fireEvent.change(screen.getByLabelText(/team name/i), { target: { value: "Alice" } });
      fireEvent.click(screen.getByRole("button", { name: /join game/i }));
      // Phase 1: spinner + "Joining…".
      expect(screen.getByTestId("submit-spinner")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /joining/i })).toBeInTheDocument();

      // Phase 2 (>2.5s): the label swaps to "Getting you into the game…".
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(
        screen.getByRole("button", { name: /getting you into the game/i }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("submit-spinner")).toBeInTheDocument();
      // No server/infrastructure wording anywhere.
      expect(screen.queryByText(/waking the server/i)).not.toBeInTheDocument();

      // Phase 3 (>30s): a calm, non-error reassurance line appears below the form.
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      expect(screen.getByText(/still loading — hang tight/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
