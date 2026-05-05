import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Portal } from "../components/Portal";
import styles from "../components/Toast.module.css";
import { ToastContext, type ToastApi, type ToastVariant } from "./toastContextValue";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const DEFAULT_DURATION_MS = 3500;

interface Props {
  children: ReactNode;
}

export function ToastProvider({ children }: Props) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastApi["toast"]>(
    (message, opts) => {
      const id = nextIdRef.current++;
      const variant: ToastVariant = opts?.variant ?? "info";
      const duration = opts?.durationMs ?? DEFAULT_DURATION_MS;
      setItems((prev) => [...prev, { id, message, variant }]);
      const handle = window.setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, handle);
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((h) => window.clearTimeout(h));
      timers.clear();
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {items.length > 0 ? (
        <Portal>
          <div className={styles.stack} role="region" aria-label="Notifications">
            {items.map((t) => (
              <div
                key={t.id}
                role="status"
                aria-live="polite"
                className={`${styles.toast} ${
                  t.variant === "success"
                    ? styles.success
                    : t.variant === "error"
                      ? styles.error
                      : styles.info
                }`}
              >
                <span className={styles.message}>{t.message}</span>
                <button
                  type="button"
                  className={styles.close}
                  aria-label="Dismiss"
                  onClick={() => dismiss(t.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Portal>
      ) : null}
    </ToastContext.Provider>
  );
}
