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

export function normalizeCode(raw: string): string {
  return (raw.toUpperCase().match(CODE_CHAR_RE) ?? []).join("").slice(0, CODE_LENGTH);
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
  return normalizeCode(raw.slice(0, Math.max(0, rawCaret))).length;
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

/** Write `chars` over the characters at `index`, keeping the code six long. */
export function overwriteAt(value: string, index: number, chars: string): string {
  return (value.slice(0, index) + chars + value.slice(index + chars.length)).slice(0, CODE_LENGTH);
}
