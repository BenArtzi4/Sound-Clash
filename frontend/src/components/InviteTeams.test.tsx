import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Team } from "../lib/types";

const qr = vi.hoisted(() => ({
  useQrSvg: vi.fn((_url: string, _size: number) => ({ svg: "<svg data-qr></svg>", error: false })),
}));
vi.mock("../hooks/useQrSvg", () => qr);

const tele = vi.hoisted(() => ({ trackEvent: vi.fn(), trackView: vi.fn() }));
vi.mock("../lib/telemetry", () => tele);

import { InviteButton, InviteCard } from "./InviteTeams";

const ORIGIN = window.location.origin;
const QR_URL = `${ORIGIN}/join/ABCDEF?src=host-qr`;
const SHARE_URL = `${ORIGIN}/join/ABCDEF?src=host-share`;
const MESSAGE = "Join my Sound Clash game! Game code: ABCDEF";

function team(id: string, name: string): Team {
  return { id, game_code: "ABCDEF", name, score: 0, joined_at: "2026-10-31T18:00:00Z" };
}

function defineGlobal(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
}

// A phone: a coarse pointer and a share sheet.
function asPhone(share: (data: unknown) => Promise<void>) {
  defineGlobal(
    window,
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  defineGlobal(navigator, "share", share);
}

function ctas(): string[] {
  return tele.trackEvent.mock.calls
    .filter(([name]) => name === "cta")
    .map(([, data]) => (data as { id: string }).id);
}

beforeEach(() => {
  tele.trackEvent.mockClear();
  qr.useQrSvg.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(window, "matchMedia");
});

describe("InviteCard", () => {
  it("shows the code and a QR that carries the host-qr tag", () => {
    render(<InviteCard gameCode="ABCDEF" teams={[]} />);

    expect(screen.getByRole("heading", { name: "Invite teams" })).toBeInTheDocument();
    expect(screen.getByText("ABCDEF")).toBeInTheDocument();
    expect(qr.useQrSvg).toHaveBeenLastCalledWith(QR_URL, 320);
    const qrButton = screen.getByTestId("invite-qr");
    expect(qrButton.querySelector("svg[data-qr]")).not.toBeNull();
    // The address printed for people who type it carries no tag.
    expect(screen.getByText(`${window.location.host.replace(/^www\./, "")}/join`)).toBeVisible();
    expect(screen.queryByText(/src=/)).not.toBeInTheDocument();
  });

  it("says who has joined", () => {
    const { rerender } = render(<InviteCard gameCode="ABCDEF" teams={[]} />);
    expect(screen.getByTestId("invite-teams-line")).toHaveTextContent("No teams yet");

    rerender(<InviteCard gameCode="ABCDEF" teams={[team("t1", "Alpha")]} />);
    expect(screen.getByTestId("invite-teams-line")).toHaveTextContent("1 team in: Alpha");

    rerender(<InviteCard gameCode="ABCDEF" teams={[team("t1", "Alpha"), team("t2", "בית")]} />);
    expect(screen.getByTestId("invite-teams-line")).toHaveTextContent("2 teams in: Alpha, בית");
  });

  it("copies the host-share link on a laptop and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(async (_text: string) => {});
    defineGlobal(navigator, "clipboard", { writeText });
    render(<InviteCard gameCode="ABCDEF" teams={[]} />);

    const button = screen.getByRole("button", { name: /copy link/i });
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
    expect(ctas()).toEqual(["invite_copy"]);

    await act(async () => {
      vi.advanceTimersByTime(2600);
    });
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("shows the link to copy by hand when the clipboard is blocked", async () => {
    defineGlobal(navigator, "clipboard", {
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    render(<InviteCard gameCode="ABCDEF" teams={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Couldn't copy");
    expect(status).toHaveTextContent(SHARE_URL);
  });

  it("links to WhatsApp with the message and the host-share link", () => {
    render(<InviteCard gameCode="ABCDEF" teams={[]} />);

    const link = screen.getByRole("link", { name: /whatsapp/i });
    expect(link).toHaveAttribute("target", "_blank");
    const href = new URL(link.getAttribute("href")!);
    expect(href.origin + href.pathname).toBe("https://wa.me/");
    expect(href.searchParams.get("text")).toBe(`${MESSAGE}\n${SHARE_URL}`);

    fireEvent.click(link);
    expect(ctas()).toEqual(["invite_whatsapp"]);
  });

  it("enlarges the QR in a sheet and closes it with Escape or the backdrop", async () => {
    render(<InviteCard gameCode="ABCDEF" teams={[]} />);

    const qrButton = screen.getByTestId("invite-qr");
    qrButton.focus();
    fireEvent.click(qrButton);

    const sheet = await screen.findByRole("dialog", { name: "Scan to join" });
    expect(ctas()).toEqual(["invite_qr_enlarge"]);
    expect(qr.useQrSvg).toHaveBeenLastCalledWith(QR_URL, 480);
    expect(within(sheet).getByText("ABCDEF")).toBeInTheDocument();
    expect(within(sheet).getByText(`${ORIGIN}/join/ABCDEF`)).toBeInTheDocument();
    expect(within(sheet).getByTestId("invite-sheet-close")).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(qrButton).toHaveFocus();

    fireEvent.click(qrButton);
    await screen.findByRole("dialog");
    // A click inside the sheet keeps it open; the backdrop closes it.
    fireEvent.click(screen.getByText(`${ORIGIN}/join/ABCDEF`));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("presentation"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  describe("on a phone", () => {
    it("opens the share sheet with the message and the host-share link", async () => {
      const share = vi.fn(async (_data: unknown) => {});
      asPhone(share);
      render(<InviteCard gameCode="ABCDEF" teams={[]} />);

      fireEvent.click(screen.getByRole("button", { name: /share invite/i }));

      await waitFor(() =>
        expect(share).toHaveBeenCalledWith({ title: "Sound Clash", text: MESSAGE, url: SHARE_URL }),
      );
      expect(ctas()).toEqual(["invite_share"]);
    });

    it("does nothing when the sheet is dismissed and copies when sharing fails", async () => {
      const writeText = vi.fn(async (_text: string) => {});
      defineGlobal(navigator, "clipboard", { writeText });
      const share = vi
        .fn()
        .mockRejectedValueOnce(new DOMException("closed", "AbortError"))
        .mockRejectedValueOnce(new Error("no share target"));
      asPhone(share);
      render(<InviteCard gameCode="ABCDEF" teams={[]} />);

      const button = screen.getByRole("button", { name: /share invite/i });
      fireEvent.click(button);
      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      expect(writeText).not.toHaveBeenCalled();

      fireEvent.click(button);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHARE_URL));
    });
  });
});

describe("InviteButton", () => {
  it("opens the invite sheet and hands focus back when it closes", async () => {
    render(<InviteButton gameCode="ABCDEF" />);

    // The QR is only generated once the sheet opens.
    expect(qr.useQrSvg).not.toHaveBeenCalled();
    const trigger = screen.getByRole("button", { name: "Invite teams" });
    expect(trigger).toHaveTextContent("Invite");
    trigger.focus();
    fireEvent.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "Scan to join" });
    expect(ctas()).toEqual(["invite_open"]);
    expect(qr.useQrSvg).toHaveBeenLastCalledWith(QR_URL, 480);
    expect(within(sheet).getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /whatsapp/i })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByTestId("invite-sheet-close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
