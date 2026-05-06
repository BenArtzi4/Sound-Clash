import { useCallback, useEffect, useRef } from "react";
import { Portal } from "./Portal";
import styles from "./ConfirmDialog.module.css";

interface Props {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Ref callback runs when the Portal commits the button into the DOM, which
  // is the only point at which we can focus it (the Portal mounts in an effect
  // after the parent's first render).
  const confirmCb = useCallback(
    (node: HTMLButtonElement | null) => {
      confirmRef.current = node;
      if (node && open) node.focus();
    },
    [open],
  );

  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      triggerRef.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onCancel} role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className={styles.dialog}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="confirm-title" className={styles.title}>
            {title}
          </h2>
          {message ? <p className={styles.message}>{message}</p> : null}
          <div className={styles.actions}>
            <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              ref={confirmCb}
              type="button"
              className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
