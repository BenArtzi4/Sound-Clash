/**
 * The six-character game code, shared by the Join and Display entry screens.
 *
 * Pure helpers only — the field that uses them is `components/GameCodeField`.
 */

export const CODE_LENGTH = 6;
export const CODE_PLACEHOLDER = "ABCDEF";

/** What `POST /games` mints: six of A-Z and 2-9. */
export const CODE_RE = /^[A-Z2-9]{6}$/;

const CODE_CHAR_RE = /[A-Z2-9]/g;

/** Every code character in `raw`, uppercased, with no length limit applied. */
function codeChars(raw: string): string {
  return (raw.toUpperCase().match(CODE_CHAR_RE) ?? []).join("");
}

export function normalizeCode(raw: string): string {
  return codeChars(raw).slice(0, CODE_LENGTH);
}

export interface CodeEdit {
  value: string;
  caret: number;
}

/**
 * The value and caret after the browser has edited the field — `raw` is what
 * the input now holds, `rawCaret` where it left the caret.
 *
 * Usually this only strips and uppercases. The case that matters is an insert
 * into an already-full code: six cells are all there is, so the characters the
 * insert pushed rightwards are dropped instead of the ones at the end. Typing
 * on a full code therefore overwrites the character the caret is on, which is
 * the only useful thing it can do — and the reason a wrong character used to
 * be unfixable without deleting your way back to it.
 *
 * Deliberately NOT done with `maxLength` plus a `beforeinput` guard. WebKit
 * truncates at `maxLength` *before* dispatching `beforeinput` and hands the
 * listener an empty `data`, so a guard cannot tell what was typed and the fix
 * silently does nothing on Safari and iOS — measured, both engines, 2026-09-20.
 * Reading the value the browser actually produced needs no per-engine
 * knowledge, and covers typing, pasting, dictation and IME alike.
 */
export function applyEdit(raw: string, rawCaret: number): CodeEdit {
  const chars = codeChars(raw);
  const caret = codeChars(raw.slice(0, Math.max(0, rawCaret))).length;
  const overflow = chars.length - CODE_LENGTH;
  const kept = overflow > 0 ? chars.slice(0, caret) + chars.slice(caret + overflow) : chars;
  return { value: kept.slice(0, CODE_LENGTH), caret: Math.min(caret, CODE_LENGTH) };
}

/**
 * Where the caret belongs once `raw` has been normalised: however many
 * characters survive to the left of where it was.
 *
 * Typing used to be append-only, so nobody noticed that normalising rewrites
 * the whole value and sends the caret to the end. Editing in the middle makes
 * that instant and obvious — type a lowercase letter into the third cell and
 * the caret would jump to the sixth.
 */
export function caretAfterNormalize(raw: string, rawCaret: number): number {
  return Math.min(codeChars(raw.slice(0, Math.max(0, rawCaret))).length, CODE_LENGTH);
}

/**
 * The cell a pointer at `clientX` is over.
 *
 * The characters are drawn by an even six-column grid, so geometry answers
 * this exactly. The browser cannot: it hit-tests the transparent input's own
 * text, which is laid out in a different font at the left edge of the box and
 * has nothing to do with where the characters appear.
 */
export function cellFromPointerX(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0)) return 0;
  const cell = Math.floor(((clientX - rect.left) / rect.width) * CODE_LENGTH);
  return Math.min(CODE_LENGTH - 1, Math.max(0, cell));
}
