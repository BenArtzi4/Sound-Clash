import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  applyEdit,
  caretAfterNormalize,
  cellFromPointerX,
  normalizeCode,
} from "./gameCode";

describe("normalizeCode", () => {
  it("uppercases and keeps only code characters", () => {
    expect(normalizeCode("ab1c0d!ef")).toBe("ABCDEF");
  });

  it("never returns more than six characters", () => {
    expect(normalizeCode("ABCDEFGHI")).toBe("ABCDEF");
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeCode("01!-")).toBe("");
  });
});

describe("caretAfterNormalize", () => {
  it("keeps the caret where the typed character landed", () => {
    // "AB" + a just-typed "X", caret after it.
    expect(caretAfterNormalize("ABXCDE", 3)).toBe(3);
  });

  it("does not count characters normalisation threw away", () => {
    // A "0" is not in the alphabet, so the caret belongs back where it was.
    expect(caretAfterNormalize("AB0CDE", 3)).toBe(2);
  });

  it("ignores everything to the right of the caret", () => {
    expect(caretAfterNormalize("ABCDEF", 2)).toBe(2);
  });

  it("clamps a caret at the end of a too-long paste", () => {
    expect(caretAfterNormalize("ABCDEFGH", 8)).toBe(CODE_LENGTH);
  });

  it("treats a negative caret as the start", () => {
    expect(caretAfterNormalize("ABCDEF", -1)).toBe(0);
  });
});

describe("cellFromPointerX", () => {
  const rect = { left: 20, width: 360 }; // 60px per cell

  it("maps a pointer to the cell under it", () => {
    expect(cellFromPointerX(20 + 30, rect)).toBe(0);
    expect(cellFromPointerX(20 + 150, rect)).toBe(2);
    expect(cellFromPointerX(20 + 330, rect)).toBe(5);
  });

  it("puts a boundary pointer in the cell it opens", () => {
    expect(cellFromPointerX(20 + 120, rect)).toBe(2);
    expect(cellFromPointerX(20 + 119, rect)).toBe(1);
  });

  it("clamps a pointer outside the field", () => {
    expect(cellFromPointerX(-500, rect)).toBe(0);
    expect(cellFromPointerX(5000, rect)).toBe(5);
  });

  it("answers 0 for an unmeasured field rather than dividing by zero", () => {
    expect(cellFromPointerX(100, { left: 0, width: 0 })).toBe(0);
  });
});

describe("applyEdit", () => {
  it("strips and uppercases an ordinary edit", () => {
    expect(applyEdit("ab1c", 4)).toEqual({ value: "ABC", caret: 3 });
  });

  it("inserts while there is still room", () => {
    // "ABC" with an X typed at index 1.
    expect(applyEdit("AXBC", 2)).toEqual({ value: "AXBC", caret: 2 });
  });

  // The whole point: six cells are all there is, so an insert into a full code
  // drops what it pushed rightwards rather than what is at the end.
  it("overwrites the character at the caret when the code was already full", () => {
    expect(applyEdit("ABXCDEF", 3)).toEqual({ value: "ABXDEF", caret: 3 });
    expect(applyEdit("XABCDEF", 1)).toEqual({ value: "XBCDEF", caret: 1 });
    expect(applyEdit("ABCDEXF", 6)).toEqual({ value: "ABCDEX", caret: 6 });
  });

  it("overwrites a run when several characters arrive at once", () => {
    expect(applyEdit("ABxyCDEF", 4)).toEqual({ value: "ABXYEF", caret: 4 });
  });

  it("changes nothing when the caret is past the last cell", () => {
    expect(applyEdit("ABCDEFX", 7)).toEqual({ value: "ABCDEF", caret: 6 });
  });

  it("keeps the caret where a rejected character was typed", () => {
    expect(applyEdit("AB0CDE", 3)).toEqual({ value: "ABCDE", caret: 2 });
  });

  it("caps an oversized paste", () => {
    expect(applyEdit("ABCDEFGHIJ", 10)).toEqual({ value: "ABCDEF", caret: 6 });
  });
});
