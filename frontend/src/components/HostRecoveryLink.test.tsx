import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostRecoveryLink } from "./HostRecoveryLink";

const UUID = "b3b8c9d0-1234-4abc-9def-0123456789ab";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("HostRecoveryLink", () => {
  it("is collapsed by default and expands to show the tokened URL", async () => {
    render(<HostRecoveryLink gameCode="ABCDEF" managerToken={UUID} />);

    expect(screen.queryByTestId("host-link-panel")).not.toBeInTheDocument();

    const toggle = screen.getByTestId("host-link-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("host-link-url")).toHaveTextContent(
      `${window.location.origin}/manager/game/ABCDEF#mt=${UUID}`,
    );
    expect(screen.getByText(/anyone with this link controls the game/i)).toBeInTheDocument();

    // The real qrcode lib renders the SVG asynchronously.
    await waitFor(() => {
      expect(screen.getByTestId("host-link-panel").querySelector("svg")).toBeInTheDocument();
    });

    // And collapses again.
    fireEvent.click(toggle);
    expect(screen.queryByTestId("host-link-panel")).not.toBeInTheDocument();
  });

  it("copies the URL and confirms, then resets the label", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    render(<HostRecoveryLink gameCode="ABCDEF" managerToken={UUID} />);
    fireEvent.click(screen.getByTestId("host-link-toggle"));

    fireEvent.click(screen.getByTestId("host-link-copy"));
    await waitFor(() => {
      expect(screen.getByTestId("host-link-copy")).toHaveTextContent(/copied/i);
    });
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/manager/game/ABCDEF#mt=${UUID}`,
    );

    // Label falls back to "Copy link" after the reset window.
    await waitFor(
      () => {
        expect(screen.getByTestId("host-link-copy")).toHaveTextContent(/copy link/i);
      },
      { timeout: 4000 },
    );
  });

  it("shows the fallback hint when the clipboard write fails", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    render(<HostRecoveryLink gameCode="ABCDEF" managerToken={UUID} />);
    fireEvent.click(screen.getByTestId("host-link-toggle"));

    fireEvent.click(screen.getByTestId("host-link-copy"));
    await waitFor(() => {
      expect(screen.getByText(/copy failed/i)).toBeInTheDocument();
    });
  });
});
