import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  caretAfterNormalize,
  cellFromPointerX,
  normalizeCode,
  overwriteAt,
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

describe("overwriteAt", () => {
  it("writes one character over the one at the index", () => {
    expect(overwriteAt("ABCDEF", 2, "X")).toBe("ABXDEF");
    expect(overwriteAt("ABCDEF", 0, "X")).toBe("XBCDEF");
    expect(overwriteAt("ABCDEF", 5, "X")).toBe("ABCDEX");
  });

  it("writes a run over the characters it covers", () => {
    expect(overwriteAt("ABCDEF", 2, "XY")).toBe("ABXYEF");
  });

  it("keeps the code six long when the run runs off the end", () => {
    expect(overwriteAt("ABCDEF", 4, "XYZW")).toBe("ABCDXY");
  });
});
