import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  getTeamRejoinToken: vi.fn(),
}));

import { getTeamRejoinToken } from "../lib/api";
import type { Team } from "../lib/types";
import { TeamRescueModal } from "./TeamRescueModal";

const TOKEN = "22222222-2222-2222-2222-222222222222";
const REJOIN = "44444444-4444-4444-4444-444444444444";

function team(id: string, name: string, score = 0): Team {
  return { id, game_code: "ABCDEF", name, score, joined_at: "2026-05-05T12:00:00Z" };
}

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

beforeEach(() => {
  vi.mocked(getTeamRejoinToken).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TeamRescueModal", () => {
  it("shows an empty state when there are no teams", () => {
    render(
      <TeamRescueModal gameCode="ABCDEF" managerToken={TOKEN} teams={[]} onClose={() => {}} />,
    );
    expect(screen.getByText(/no teams have joined/i)).toBeInTheDocument();
    expect(getTeamRejoinToken).not.toHaveBeenCalled();
  });

  it("lists teams and reveals a rejoin QR only for the picked team", async () => {
    vi.mocked(getTeamRejoinToken).mockResolvedValueOnce({ team_id: "t1", rejoin_token: REJOIN });
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors", 30), team("t2", "Sharks", 25)]}
        onClose={() => {}}
      />,
    );
    // Both teams are listed; no token is fetched until one is picked.
    expect(screen.getByTestId("rescue-team-t1")).toBeInTheDocument();
    expect(screen.getByTestId("rescue-team-t2")).toBeInTheDocument();
    expect(getTeamRejoinToken).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("rescue-team-t1"));
    await waitFor(() => {
      expect(getTeamRejoinToken).toHaveBeenCalledWith("ABCDEF", "t1", TOKEN);
    });
    await waitFor(() => {
      expect(screen.getByTestId("rescue-url")).toHaveTextContent(
        `${window.location.origin}/join/ABCDEF#rt=${REJOIN}`,
      );
    });
    // The real qrcode lib renders the SVG asynchronously.
    await waitFor(() => {
      expect(screen.getByTestId("rescue-qr").querySelector("svg")).toBeInTheDocument();
    });
    expect(getTeamRejoinToken).toHaveBeenCalledTimes(1);
  });

  it("goes back to the team list from the QR view", async () => {
    vi.mocked(getTeamRejoinToken).mockResolvedValueOnce({ team_id: "t1", rejoin_token: REJOIN });
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors")]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rescue-team-t1"));
    await waitFor(() => expect(screen.getByTestId("rescue-qr")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /back to teams/i }));
    expect(screen.getByTestId("rescue-team-t1")).toBeInTheDocument();
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors")]}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("rescue-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("copies the rejoin link and confirms", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    vi.mocked(getTeamRejoinToken).mockResolvedValueOnce({ team_id: "t1", rejoin_token: REJOIN });
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors")]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rescue-team-t1"));
    await waitFor(() => expect(screen.getByTestId("rescue-copy")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("rescue-copy"));
    await waitFor(() => expect(screen.getByTestId("rescue-copy")).toHaveTextContent(/copied/i));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/ABCDEF#rt=${REJOIN}`);
  });

  it("shows the fallback hint when the clipboard write fails", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    vi.mocked(getTeamRejoinToken).mockResolvedValueOnce({ team_id: "t1", rejoin_token: REJOIN });
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors")]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rescue-team-t1"));
    await waitFor(() => expect(screen.getByTestId("rescue-copy")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("rescue-copy"));
    await waitFor(() => expect(screen.getByText(/copy failed/i)).toBeInTheDocument());
  });

  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors")]}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error when the token can't be loaded", async () => {
    vi.mocked(getTeamRejoinToken).mockRejectedValueOnce(new Error("boom"));
    render(
      <TeamRescueModal
        gameCode="ABCDEF"
        managerToken={TOKEN}
        teams={[team("t1", "Warriors")]}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("rescue-team-t1"));
    await waitFor(() => expect(screen.getByText(/couldn't load/i)).toBeInTheDocument());
  });
});
