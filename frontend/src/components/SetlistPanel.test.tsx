import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  checkSetlist: vi.fn(),
}));

import { ToastProvider } from "../context/ToastContext";
import { ToastContext, type ToastApi } from "../context/toastContextValue";
import { ApiError, checkSetlist } from "../lib/api";
import type { SetlistCheckResponse } from "../lib/types";
import { SetlistPanel, type SetlistPanelState } from "./SetlistPanel";

// Made-up names only.
const LIST = [
  "Moonfish - Glass Harbor",
  "Velvet Otters",
  "Paper Lanterns - Slow Rain",
  "Nobody - Not A Real Song",
].join("\n");

const ANSWER: SetlistCheckResponse = {
  lines_total: 4,
  ready: [
    { line: "Moonfish - Glass Harbor", title: "Glass Harbor", artist: "Moonfish", songs: 1 },
    { line: "Velvet Otters", title: null, artist: "Velvet Otters", songs: 3 },
    { line: "Paper Lanterns - Slow Rain", title: "Slow Rain", artist: "Paper Lanterns", songs: 1 },
  ],
  not_found: [{ line: "Nobody - Not A Real Song", reason: "not_in_catalog" }],
  list_songs: 5,
  same_artist_songs: 56,
  pool_size: 61,
};

// The layout of Chosic's TXT download: "Artist,Artist2 - Title", CRLF after each line.
const CHOSIC_TXT =
  "Mira Solenne - Paper Lanterns\r\n" +
  "Dax Corvin,Lila Moon - Northern Wires\r\n" +
  "The Velvet Orchards - Kite Season - 2019 Remaster\r\n";

const SPOTIFY_LINKS = "https://open.spotify.com/track/abc\nhttps://open.spotify.com/track/def";
const LINKS_LINE = "These are links, not song names.";
const TOO_LONG = "Your list is too long: at most 300 songs and 20,000 characters.";
const HELP_TITLE = "Have the list on Spotify?";

const EMPTY: SetlistPanelState = { text: "", check: null, checking: false };

// The page owns the state (Task 10b); here a small holder stands in for it.
// Its "Other tab" button takes the panel away and brings it back, as a tab
// change does, while the state stays.
function Holder(props: { initial: SetlistPanelState; onChange: (s: SetlistPanelState) => void }) {
  const [value, setValue] = useState(props.initial);
  const [shown, setShown] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setShown((s) => !s)}>
        Other tab
      </button>
      {shown ? (
        <SetlistPanel
          value={value}
          onChange={(next) => {
            props.onChange(next);
            setValue(next);
          }}
        />
      ) : null}
    </>
  );
}

function renderPanel(initial: Partial<SetlistPanelState> = {}, toastSpy?: ToastApi["toast"]) {
  const onChange = vi.fn<(s: SetlistPanelState) => void>();
  const panel = <Holder initial={{ ...EMPTY, ...initial }} onChange={onChange} />;
  render(
    toastSpy ? (
      <ToastContext.Provider value={{ toast: toastSpy, dismiss: vi.fn() }}>
        {panel}
      </ToastContext.Provider>
    ) : (
      <ToastProvider>{panel}</ToastProvider>
    ),
  );
  return { onChange };
}

function typeList(text: string) {
  fireEvent.change(screen.getByTestId("setlist-input"), { target: { value: text } });
}

function checkButton() {
  return screen.getByTestId("setlist-check");
}

function helpToggle() {
  return within(screen.getByTestId("setlist-help")).getByRole("button", { name: HELP_TITLE });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(checkSetlist).mockReset();
});

describe("SetlistPanel", () => {
  it("counts songs while the host types", () => {
    const { onChange } = renderPanel();
    const input = screen.getByLabelText("Paste a list of songs");
    expect(input).toBe(screen.getByTestId("setlist-input"));
    expect(input).toHaveAttribute(
      "placeholder",
      "One per line: Artist - Song. A film or an artist alone works too.",
    );
    expect(screen.queryByTestId("setlist-found")).not.toBeInTheDocument();
    expect(checkButton()).toBeDisabled();

    typeList("Moonfish - Glass Harbor");
    expect(screen.getByTestId("setlist-found")).toHaveTextContent(/^Found 1 song$/);
    expect(onChange).toHaveBeenLastCalledWith({
      text: "Moonfish - Glass Harbor",
      check: null,
      checking: false,
    });
    expect(checkButton()).toBeEnabled();

    typeList("Moonfish - Glass Harbor\n\n# side B\nVelvet Otters - Neon Tide");
    expect(screen.getByTestId("setlist-found")).toHaveTextContent(/^Found 2 songs$/);

    typeList(CHOSIC_TXT);
    expect(screen.getByTestId("setlist-found")).toHaveTextContent(/^Found 3 songs$/);

    typeList("  \n# only a note\n");
    expect(screen.queryByTestId("setlist-found")).not.toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    // The endpoint is rate-limited: typing never checks.
    expect(checkSetlist).not.toHaveBeenCalled();
  });

  it("checks the list and shows the counts", async () => {
    const answer = deferred<SetlistCheckResponse>();
    vi.mocked(checkSetlist).mockReturnValueOnce(answer.promise);
    const { onChange } = renderPanel({ text: LIST });
    expect(checkButton()).toHaveTextContent(/^Check my list$/);
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();

    fireEvent.click(checkButton());
    expect(checkSetlist).toHaveBeenCalledWith(LIST);
    expect(onChange).toHaveBeenLastCalledWith({ text: LIST, check: null, checking: true });
    expect(checkButton()).toBeDisabled();
    expect(checkButton()).toHaveTextContent(/^Checking your list…$/);

    await act(async () => answer.resolve(ANSWER));
    const result = await screen.findByTestId("setlist-result");
    expect(onChange).toHaveBeenLastCalledWith({ text: LIST, check: ANSWER, checking: false });
    // The answer is for this text: nothing to check again until it changes
    // (the endpoint is rate-limited).
    expect(checkButton()).toBeDisabled();
    expect(checkButton()).toHaveTextContent(/^Check my list$/);

    expect(within(result).getByText("Your list: 4 lines")).toBeInTheDocument();
    expect(within(result).getByText("3 ready to play")).toBeInTheDocument();
    expect(within(result).getByText("1 cannot play")).toBeInTheDocument();
    expect(within(result).getByRole("button", { name: "Show" })).toBeInTheDocument();
    expect(
      within(result).getByText("+ 56 more by the same artists, played after your list"),
    ).toBeInTheDocument();
    const pool = within(result).getByText("61 songs in this game");
    expect(pool).toHaveAttribute("data-tone", "ok");
    expect(checkSetlist).toHaveBeenCalledTimes(1);
  });

  it("lists the lines that cannot play, with the reason", () => {
    const check: SetlistCheckResponse = {
      ...ANSWER,
      ready: ANSWER.ready.slice(0, 2),
      not_found: [
        { line: "Nobody - Not A Real Song", reason: "not_in_catalog" },
        { line: "Glass Harbor", reason: "several_songs_share_this_name" },
      ],
    };
    renderPanel({ text: LIST, check });
    const result = screen.getByTestId("setlist-result");
    expect(within(result).getByText("2 ready to play")).toBeInTheDocument();
    expect(within(result).getByText("2 cannot play")).toBeInTheDocument();
    expect(screen.queryByTestId("setlist-missing")).not.toBeInTheDocument();

    const show = within(result).getByRole("button", { name: "Show" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(show);
    expect(show).toHaveAttribute("aria-expanded", "true");
    expect(show).toHaveTextContent("Hide");

    const items = within(screen.getByTestId("setlist-missing")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Nobody - Not A Real Song")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Not in the game yet")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Glass Harbor")).toBeInTheDocument();
    expect(
      within(items[1]!).getByText("More than one song has this name. Add the artist."),
    ).toBeInTheDocument();

    fireEvent.click(show);
    expect(screen.queryByTestId("setlist-missing")).not.toBeInTheDocument();
  });

  it("hides the counts that are 0 and warns about a small game", () => {
    renderPanel({
      text: "Moonfish - Glass Harbor",
      check: {
        lines_total: 1,
        ready: [ANSWER.ready[0]!],
        not_found: [],
        list_songs: 1,
        same_artist_songs: 0,
        pool_size: 1,
      },
    });
    const result = screen.getByTestId("setlist-result");
    expect(within(result).getByText("Your list: 1 line")).toBeInTheDocument();
    expect(within(result).getByText("1 ready to play")).toBeInTheDocument();
    expect(within(result).queryByText(/cannot play/)).not.toBeInTheDocument();
    expect(within(result).queryByText(/more by the same artists/)).not.toBeInTheDocument();
    expect(
      within(result).getByText("Only 1 song in this game, enough for 1 round."),
    ).toHaveAttribute("data-tone", "small");
  });

  it("says when no song of the list can play", () => {
    renderPanel({
      text: "Nobody - Not A Real Song",
      check: {
        lines_total: 1,
        ready: [],
        not_found: [{ line: "Nobody - Not A Real Song", reason: "not_in_catalog" }],
        list_songs: 0,
        same_artist_songs: 0,
        pool_size: 0,
      },
    });
    const result = screen.getByTestId("setlist-result");
    expect(within(result).getByText("0 ready to play")).toBeInTheDocument();
    expect(within(result).getByText("1 cannot play")).toBeInTheDocument();
    expect(within(result).getByText("None of the songs in your list can play.")).toHaveAttribute(
      "data-tone",
      "empty",
    );
  });

  it("turns the check off when the text changes", () => {
    const { onChange } = renderPanel({ text: LIST, check: ANSWER });
    expect(screen.getByTestId("setlist-result")).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();

    typeList(`${LIST}\nGlass Harbor`);
    expect(onChange).toHaveBeenLastCalledWith({
      text: `${LIST}\nGlass Harbor`,
      check: null,
      checking: false,
    });
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();
    // The edited text can be checked.
    expect(checkButton()).toBeEnabled();
  });

  it("drops a late answer when the text changed while the check ran", async () => {
    const answer = deferred<SetlistCheckResponse>();
    vi.mocked(checkSetlist).mockReturnValueOnce(answer.promise);
    const { onChange } = renderPanel({ text: LIST });
    fireEvent.click(checkButton());

    typeList(`${LIST}\nGlass Harbor`);
    // The edit ends the wait: the host can check the new text.
    expect(checkButton()).toBeEnabled();
    expect(checkButton()).toHaveTextContent(/^Check my list$/);

    await act(async () => answer.resolve(ANSWER));
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ check: ANSWER }));
    expect(onChange).toHaveBeenLastCalledWith({
      text: `${LIST}\nGlass Harbor`,
      check: null,
      checking: false,
    });
  });

  it("keeps an edit made after a tab change while the check ran", async () => {
    const answer = deferred<SetlistCheckResponse>();
    vi.mocked(checkSetlist).mockReturnValueOnce(answer.promise);
    const { onChange } = renderPanel({ text: LIST });
    fireEvent.click(checkButton());

    // To the other tab and back: a new panel, the same state.
    fireEvent.click(screen.getByRole("button", { name: "Other tab" }));
    expect(screen.queryByTestId("setlist-input")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Other tab" }));
    expect(checkButton()).toHaveTextContent(/^Checking your list…$/);
    typeList("Moonfish - Glass Harbor");

    await act(async () => answer.resolve(ANSWER));
    expect(screen.getByTestId("setlist-input")).toHaveValue("Moonfish - Glass Harbor");
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({
      text: "Moonfish - Glass Harbor",
      check: null,
      checking: false,
    });
  });

  it("shows the answer after a tab change when the text stayed the same", async () => {
    const answer = deferred<SetlistCheckResponse>();
    vi.mocked(checkSetlist).mockReturnValueOnce(answer.promise);
    renderPanel({ text: LIST });
    fireEvent.click(checkButton());
    fireEvent.click(screen.getByRole("button", { name: "Other tab" }));

    // The answer lands while the host is on the other tab.
    await act(async () => answer.resolve(ANSWER));
    fireEvent.click(screen.getByRole("button", { name: "Other tab" }));
    expect(screen.getByTestId("setlist-result")).toBeInTheDocument();
    expect(checkButton()).toHaveTextContent(/^Check my list$/);
  });

  it("drops a late refusal when the text changed while the check ran", async () => {
    const answer = deferred<SetlistCheckResponse>();
    vi.mocked(checkSetlist).mockReturnValueOnce(answer.promise);
    const toast = vi.fn<ToastApi["toast"]>(() => 1);
    renderPanel({ text: LIST }, toast);
    fireEvent.click(checkButton());
    typeList("Moonfish - Glass Harbor");

    await act(async () => answer.reject(new ApiError("setlist_too_long", TOO_LONG, 400)));
    expect(toast).not.toHaveBeenCalled();
    expect(checkButton()).toBeEnabled();
  });

  it("keeps the helper closed until its toggle opens it", () => {
    renderPanel({ text: LIST });
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    fireEvent.click(helpToggle());
    expect(helpToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Chosic's playlist exporter" })).toBeInTheDocument();
    expect(screen.queryByText(LINKS_LINE)).not.toBeInTheDocument();

    fireEvent.click(helpToggle());
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the helper when Spotify links are pasted", () => {
    renderPanel();
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");

    typeList(SPOTIFY_LINKS);
    const help = screen.getByTestId("setlist-help");
    expect(helpToggle()).toHaveAttribute("aria-expanded", "true");
    expect(within(help).getByText(LINKS_LINE)).toBeInTheDocument();
    expect(within(help).getByRole("link", { name: "Chosic's playlist exporter" })).toBeVisible();
    expect(screen.queryByTestId("setlist-found")).not.toBeInTheDocument();
    expect(checkButton()).toBeDisabled();

    // The host can still close it, and more links do not open it again.
    fireEvent.click(helpToggle());
    typeList(`${SPOTIFY_LINKS}\nhttps://open.spotify.com/track/ghi`);
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");
    expect(within(help).getByText(LINKS_LINE)).toBeInTheDocument();

    // Song names: the links line goes.
    typeList("Moonfish - Glass Harbor");
    expect(within(help).queryByText(LINKS_LINE)).not.toBeInTheDocument();
  });

  it("opens the helper for links under a header or beside a line of stars", () => {
    renderPanel();
    typeList(`Track Name,Artist Name\n${SPOTIFY_LINKS}`);
    expect(helpToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(LINKS_LINE)).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();

    fireEvent.click(helpToggle());
    typeList(`${SPOTIFY_LINKS}\n***`);
    expect(screen.getByText(LINKS_LINE)).toBeInTheDocument();
  });

  it("opens the helper when it comes back to a list of links", () => {
    // The page keeps the text while the host is on another tab (Task 10b).
    renderPanel({ text: SPOTIFY_LINKS });
    expect(helpToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(LINKS_LINE)).toBeInTheDocument();
  });

  it("shows the server's message for a refused list", async () => {
    vi.mocked(checkSetlist).mockRejectedValueOnce(new ApiError("setlist_too_long", TOO_LONG, 400));
    const toast = vi.fn<ToastApi["toast"]>(() => 1);
    const { onChange } = renderPanel({ text: LIST }, toast);

    fireEvent.click(checkButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith(TOO_LONG, { variant: "error" }));
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({ text: LIST, check: null, checking: false });
    expect(checkButton()).toBeEnabled();
    expect(checkButton()).toHaveTextContent(/^Check my list$/);
    // A long list is not a links problem: the helper stays closed.
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("shows the refusal in the page's toast", async () => {
    vi.mocked(checkSetlist).mockRejectedValueOnce(new ApiError("setlist_too_long", TOO_LONG, 400));
    renderPanel({ text: LIST });
    fireEvent.click(checkButton());
    expect(await screen.findByText(TOO_LONG)).toBeInTheDocument();
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();
  });

  it("opens the helper when the server reads the list as links only", async () => {
    vi.mocked(checkSetlist).mockRejectedValueOnce(
      new ApiError("setlist_links_only", LINKS_LINE, 400),
    );
    renderPanel({ text: "Moonfish - Glass Harbor" });
    expect(helpToggle()).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(checkButton());
    await waitFor(() => expect(helpToggle()).toHaveAttribute("aria-expanded", "true"));
    const help = screen.getByTestId("setlist-help");
    expect(within(help).getByText(LINKS_LINE)).toBeInTheDocument();
    // The toast says it too (its portal mounts one render later).
    await waitFor(() => expect(screen.getAllByText(LINKS_LINE)).toHaveLength(2));
    expect(screen.queryByTestId("setlist-result")).not.toBeInTheDocument();

    // The line was about that text: an edit takes it away, the helper stays open.
    typeList("Moonfish - Glass Harbor\nVelvet Otters");
    expect(within(help).queryByText(LINKS_LINE)).not.toBeInTheDocument();
    expect(helpToggle()).toHaveAttribute("aria-expanded", "true");
  });
});
