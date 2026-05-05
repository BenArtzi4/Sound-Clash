import { useEffect, useRef } from "react";
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

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    confirmRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
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
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
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
