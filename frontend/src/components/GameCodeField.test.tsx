import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameCodeField } from "./GameCodeField";

// 360px wide, so each of the six cells is 60px and the middle of cell i sits
// at (i + 0.5) * 60. jsdom has no layout, so the field has to be told its size.
const RECT = {
  left: 0,
  width: 360,
  top: 0,
  right: 360,
  bottom: 64,
  height: 64,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

const cellX = (i: number) => (i + 0.5) * 60;

function Harness({ initial = "", ariaLabel }: { initial?: string; ariaLabel?: string }) {
  const [code, setCode] = useState(initial);
  return (
    <>
      {ariaLabel ? null : <label htmlFor="game-code">Game code</label>}
      <GameCodeField
        id={ariaLabel ? undefined : "game-code"}
        ariaLabel={ariaLabel}
        value={code}
        onChange={setCode}
      />
    </>
  );
}

function setup(initial = "", ariaLabel?: string) {
  render(<Harness initial={initial} ariaLabel={ariaLabel} />);
  const input = screen.getByLabelText(/game code/i) as HTMLInputElement;
  const box = screen.getByTestId("game-code-field");
  vi.spyOn(box, "getBoundingClientRect").mockReturnValue(RECT);
  const cells = () => Array.from(box.querySelectorAll<HTMLElement>("[data-cell]"));
  return { input, box, cells };
}

/** Move the caret the way a key press would, then let the field notice. */
function moveCaret(input: HTMLInputElement, start: number, end = start) {
  input.setSelectionRange(start, end);
  fireEvent.keyUp(input, { key: "ArrowLeft" });
}

/** What the browser leaves behind after an edit: a new value and a caret. */
function editRaw(input: HTMLInputElement, raw: string, caret: number) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setValue?.call(input, raw);
  input.setSelectionRange(caret, caret);
  fireEvent.input(input);
}

const caretAt = (cells: HTMLElement[]) => cells.map((c) => c.dataset.caret ?? "").join("|");
const selectedAt = (cells: HTMLElement[]) =>
  cells.map((c) => (c.dataset.selected === "true" ? "#" : ".")).join("");

describe("GameCodeField", () => {
  it("shows the placeholder in the cells while the field is empty", () => {
    const { cells } = setup();
    expect(cells().map((c) => c.textContent)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("drops the placeholder once a character is typed", () => {
    const { cells } = setup("AB");
    expect(cells().map((c) => c.textContent)).toEqual(["A", "B", "", "", "", ""]);
  });

  it("names the field for screen readers when the page has no visible label", () => {
    setup("", "Game code");
    expect(screen.getByLabelText("Game code")).toBeInTheDocument();
  });

  // The bug this component exists to fix: the caret used to be pinned to the
  // next empty cell, so arrowing back to a character showed nothing at all.
  it("draws the caret in the cell the selection sits in", () => {
    const { input, cells } = setup("ABCDEF");
    moveCaret(input, 3);
    expect(caretAt(cells())).toBe("|||before||");
  });

  it("draws the caret past the last cell when the selection is at the end", () => {
    const { input, cells } = setup("ABCDEF");
    moveCaret(input, 6);
    expect(caretAt(cells())).toBe("|||||after");
  });

  it("follows the caret from cell to cell", () => {
    const { input, cells } = setup("ABCDEF");
    moveCaret(input, 1);
    expect(caretAt(cells())).toBe("|before||||");
    moveCaret(input, 0);
    expect(caretAt(cells())).toBe("before|||||");
  });

  it("lights every cell a range selection covers", () => {
    const { input, cells } = setup("ABCDEF");
    moveCaret(input, 1, 4);
    expect(selectedAt(cells())).toBe(".###..");
    expect(caretAt(cells())).toBe("|||||");
  });

  it("selects the character you tap, so it can be replaced or deleted", () => {
    const { input, cells } = setup("ABCDEF");
    fireEvent.click(input, { clientX: cellX(2) });
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 3]);
    expect(selectedAt(cells())).toBe("..#...");
  });

  it("puts the caret at the end when you tap past the last character", () => {
    const { input, cells } = setup("ABC");
    fireEvent.click(input, { clientX: cellX(5) });
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    expect(caretAt(cells())).toBe("|||before||");
  });

  it("leaves a selection the user made themselves alone", () => {
    const { input } = setup("ABCDEF");
    input.setSelectionRange(0, 6);
    fireEvent.click(input, { clientX: cellX(2), detail: 2 });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 6]);
  });

  // The keystroke used to be dropped outright, which is why a wrong character
  // was unfixable without deleting one first.
  it("replaces the character at the caret when the code is full", () => {
    const { input, cells } = setup("ABCDEF");
    editRaw(input, "ABXCDEF", 3); // the browser inserted X at the caret
    expect(input).toHaveValue("ABXDEF");
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    expect(caretAt(cells())).toBe("|||before||");
  });

  it("replaces the character the tap selected", () => {
    const { input } = setup("ABCDEF");
    fireEvent.click(input, { clientX: cellX(0) });
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    editRaw(input, "XBCDEF", 1); // the browser replaced the selected character
    expect(input).toHaveValue("XBCDEF");
  });

  it("inserts rather than overwrites while there is still room", () => {
    const { input } = setup("ABC");
    editRaw(input, "AXBC", 2);
    expect(input).toHaveValue("AXBC");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
  });

  it("changes nothing when the caret is past the last cell of a full code", () => {
    const { input } = setup("ABCDEF");
    editRaw(input, "ABCDEFX", 7);
    expect(input).toHaveValue("ABCDEF");
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 6]);
  });

  it("does not write a character outside the code alphabet over a full code", () => {
    const { input } = setup("ABCDEF");
    editRaw(input, "AB0CDEF", 3);
    expect(input).toHaveValue("ABCDEF");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
  });

  it("uppercases a replacement typed over a full code", () => {
    const { input } = setup("ABCDEF");
    editRaw(input, "xABCDEF", 1);
    expect(input).toHaveValue("XBCDEF");
  });

  it("pastes over a full code from the caret", () => {
    const { input } = setup("ABCDEF");
    editRaw(input, "ABxyCDEF", 4); // two characters pasted at the caret
    expect(input).toHaveValue("ABXYEF");
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
  });

  // Normalising rewrites the whole value, which is what used to throw the
  // caret to the end the moment you edited anywhere but the end.
  it("keeps the caret where the edit happened when a character is rejected", () => {
    const { input, cells } = setup("ABCDE");
    editRaw(input, "AB0CDE", 3); // a "0" typed into the third cell
    expect(input).toHaveValue("ABCDE");
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
    expect(caretAt(cells())).toBe("||before|||");
  });

  it("keeps the caret after a character inserted in the middle", () => {
    const { input, cells } = setup("ABDEF");
    editRaw(input, "ABcDEF", 3); // a "c" typed into the third cell
    expect(input).toHaveValue("ABCDEF");
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    expect(caretAt(cells())).toBe("|||before||");
  });

  it("strips everything that is not a code character as you type", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: "ab1c0d!ef" } });
    expect(input).toHaveValue("ABCDEF");
  });
});
