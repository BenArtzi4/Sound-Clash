import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SetlistHelp } from "./SetlistHelp";

const TITLE = "Have the list on Spotify?";
const LINKS_LINE = "These are links, not song names.";

function renderHelp(props: { open: boolean; linksPasted?: boolean }) {
  const onToggle = vi.fn();
  render(
    <SetlistHelp open={props.open} onToggle={onToggle} linksPasted={props.linksPasted ?? false} />,
  );
  return { onToggle, help: screen.getByTestId("setlist-help") };
}

describe("SetlistHelp", () => {
  it("shows only its title while closed, and asks to open on a tap", () => {
    const { onToggle, help } = renderHelp({ open: false });
    const toggle = within(help).getByRole("button", { name: TITLE });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(help).queryByRole("link")).not.toBeInTheDocument();
    expect(within(help).queryByText(LINKS_LINE)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("gives the three steps, with Chosic's exporter in a new tab", () => {
    const { help } = renderHelp({ open: true });
    expect(within(help).getByRole("button", { name: TITLE })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Numbered by the list itself: the browser draws "1.", "2.", "3.".
    const steps = within(help).getAllByRole("listitem");
    expect(steps[0]?.parentElement?.tagName).toBe("OL");
    expect(steps.map((li) => li.textContent)).toEqual([
      "Open Chosic's playlist exporter",
      "Paste your playlist link there and download the TXT file",
      "Paste the text here",
    ]);

    const link = within(help).getByRole("link", { name: "Chosic's playlist exporter" });
    expect(link).toHaveAttribute("href", "https://www.chosic.com/spotify-playlist-exporter/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("names the Apple Music export and says Sound Clash is not connected to these sites", () => {
    const { help } = renderHelp({ open: true });
    expect(
      within(help).getByText("On a Mac with Apple Music: File → Library → Export Playlist."),
    ).toBeInTheDocument();
    const last = within(help).getByText(
      "Sound Clash is not connected to Spotify, Apple Music or Chosic.",
    );
    // The last line of the helper.
    const lines = help.querySelectorAll("p");
    expect(lines[lines.length - 1]).toBe(last);
  });

  it("says at its top when links were pasted", () => {
    const { help } = renderHelp({ open: true, linksPasted: true });
    const line = within(help).getByText(LINKS_LINE);
    expect(help.firstElementChild).toBe(line);
  });

  it("keeps the links line when the host closes the steps", () => {
    const { help } = renderHelp({ open: false, linksPasted: true });
    expect(help.firstElementChild).toBe(within(help).getByText(LINKS_LINE));
    expect(within(help).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows no links line when the paste holds song names", () => {
    const { help } = renderHelp({ open: true, linksPasted: false });
    expect(within(help).queryByText(LINKS_LINE)).not.toBeInTheDocument();
  });
});
