import { createContext } from "react";

export type ToastVariant = "info" | "success" | "error";

export interface ToastApi {
  toast: (message: string, opts?: { variant?: ToastVariant; durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);
