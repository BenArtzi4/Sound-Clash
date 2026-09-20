import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, MouseEvent } from "react";
import {
  CODE_LENGTH,
  CODE_PLACEHOLDER,
  caretAfterNormalize,
  cellFromPointerX,
  normalizeCode,
  overwriteAt,
} from "../lib/gameCode";
import styles from "./GameCodeField.module.css";

const CELLS = [0, 1, 2, 3, 4, 5];

type Caret = { start: number; end: number };

type Props = {
  value: string;
  /** Always receives a normalised code, so callers can store it as-is. */
  onChange: (next: string) => void;
  /** Set when the page renders its own `<label htmlFor>`. */
  id?: string;
  /** Set instead when it doesn't, so the field is still named. */
  ariaLabel?: string;
  autoFocus?: boolean;
  required?: boolean;
};

/**
 * The six-cell game-code field: one real `<input>` covered by a grid that
 * draws the characters (migration of the letter-spacing field — see the
 * stylesheet), plus the editing behaviour a fixed-length code needs.
 *
 * Three things the plain input cannot do on its own, all of them about being
 * able to fix one character rather than retype six:
 *
 *  - the caret is invisible (the input is transparent), so we draw it, from
 *    the input's real selection rather than from "the next empty cell";
 *  - a tap has to land on the cell under the finger, which needs geometry;
 *  - a full code has no room to insert into, so `maxLength` swallows the
 *    keystroke and nothing happens at all. When full, a typed character
 *    overwrites the one the caret is on.
 *
 * Everything else stays native: Backspace, Delete, arrows, Home/End,
 * Shift+arrow, select-all, drag-select, paste and autofill are the browser's.
 */
export function GameCodeField({ value, onChange, id, ariaLabel, autoFocus, required }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const desired = useRef<Caret | null>(null);
  const [caret, setCaret] = useState<Caret>({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);

  const readCaret = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    setCaret((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  // Write the value we are about to report straight into the input, then place
  // the caret. React restores a controlled input's DOM value after every change
  // event, and that reset drops the caret at the end; handing it a value that
  // already matches leaves it nothing to restore.
  const commit = useCallback(
    (next: string, at: number) => {
      const el = inputRef.current;
      if (el) {
        if (el.value !== next) el.value = next;
        el.setSelectionRange(at, at);
      }
      desired.current = { start: at, end: at };
      setCaret({ start: at, end: at });
      onChange(next);
    },
    [onChange],
  );

  // Belt and braces for the same thing: if the commit above was undone by the
  // re-render (a parent that transformed the value, say), put the caret back.
  useLayoutEffect(() => {
    const el = inputRef.current;
    const want = desired.current;
    if (!el || !want) return;
    desired.current = null;
    if (el.selectionStart !== want.start || el.selectionEnd !== want.end) {
      el.setSelectionRange(want.start, want.end);
      setCaret(want);
    }
  }, [value]);

  // Overwrite-when-full. The native `beforeinput` event is what carries
  // `inputType`; React's synthetic `onBeforeInput` does not, so it can't tell a
  // typed character from a paste or a deletion.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    function onBeforeInput(e: Event) {
      if (!node) return;
      const input = e as InputEvent;
      if (input.inputType !== "insertText") return;
      if (value.length < CODE_LENGTH) return; // room to insert: leave it native
      const start = node.selectionStart ?? 0;
      if (start !== (node.selectionEnd ?? start)) return; // a range replaces natively
      if (start >= CODE_LENGTH) return; // past the last cell: nothing to overwrite
      const chars = normalizeCode(input.data ?? "");
      if (!chars) return; // not a code character: let it be rejected as usual
      e.preventDefault();
      commit(overwriteAt(value, start, chars), Math.min(start + chars.length, CODE_LENGTH));
    }
    node.addEventListener("beforeinput", onBeforeInput);
    return () => node.removeEventListener("beforeinput", onBeforeInput);
  }, [value, commit]);

  // The caret can also move without an input event — arrows, Home/End, a drag,
  // a touch handle. `selectionchange` is the only event that reports all of it.
  useEffect(() => {
    if (!focused) return;
    document.addEventListener("selectionchange", readCaret);
    return () => document.removeEventListener("selectionchange", readCaret);
  }, [focused, readCaret]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const raw = el.value;
    commit(normalizeCode(raw), caretAfterNormalize(raw, el.selectionStart ?? raw.length));
  }

  // Put the caret where the tap landed, by grid geometry. Tapping a character
  // selects it: type and it is replaced, Backspace and it is gone — which is
  // how "fix this one" works with no keyboard to arrow around with.
  function handleClick(e: MouseEvent<HTMLInputElement>) {
    const el = inputRef.current;
    const box = boxRef.current;
    if (!el || !box) return;
    // A double-click, or a drag that already produced a range, is the user
    // selecting for themselves. Leave it alone.
    if (e.detail > 1 || (el.selectionEnd ?? 0) > (el.selectionStart ?? 0)) {
      readCaret();
      return;
    }
    const cell = cellFromPointerX(e.clientX, box.getBoundingClientRect());
    const next =
      cell < value.length
        ? { start: cell, end: cell + 1 }
        : { start: value.length, end: value.length };
    el.setSelectionRange(next.start, next.end);
    setCaret(next);
  }

  // Same rule as typing: with the code full and the caret on a cell, a paste
  // writes over it rather than being dropped by maxLength.
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    if (value.length < CODE_LENGTH) return;
    if (start !== (el.selectionEnd ?? start) || start >= CODE_LENGTH) return;
    const chars = normalizeCode(e.clipboardData.getData("text"));
    if (!chars) return;
    e.preventDefault();
    commit(overwriteAt(value, start, chars), Math.min(start + chars.length, CODE_LENGTH));
  }

  const collapsed = caret.start === caret.end;

  return (
    <div className={styles.box} ref={boxRef} data-testid="game-code-field">
      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        className={styles.input}
        value={value}
        onChange={handleChange}
        onClick={handleClick}
        onPaste={handlePaste}
        onSelect={readCaret}
        onKeyUp={readCaret}
        onFocus={() => {
          setFocused(true);
          readCaret();
        }}
        onBlur={() => setFocused(false)}
        placeholder={CODE_PLACEHOLDER}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
        maxLength={CODE_LENGTH}
        autoFocus={autoFocus}
        required={required}
      />
      {/* The characters you see. aria-hidden: the input above is the real
          control and already announces its own value. */}
      <div className={styles.cells} aria-hidden="true">
        {CELLS.map((i) => {
          const side = !collapsed
            ? undefined
            : caret.start === i
              ? "before"
              : caret.start === CODE_LENGTH && i === CODE_LENGTH - 1
                ? "after"
                : undefined;
          return (
            <span
              key={i}
              className={[styles.cell, value[i] ? "" : styles.cellEmpty].filter(Boolean).join(" ")}
              data-cell={i}
              data-caret={side}
              data-selected={!collapsed && i >= caret.start && i < caret.end ? "true" : undefined}
            >
              {value[i] ?? (value.length === 0 ? CODE_PLACEHOLDER[i] : "")}
            </span>
          );
        })}
      </div>
    </div>
  );
}
