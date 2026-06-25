import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { env } from "./lib/env";
import { initTelemetry } from "./lib/telemetry";
import "./styles.css";

if (env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: env.VITE_SENTRY_DSN, tracesSampleRate: 0 });
}

// Latency telemetry → Grafana Cloud (Tempo/Loki) via Grafana Faro. No-op when
// VITE_FARO_URL is unset (dev/tests). The Faro SDK is a lazy chunk and init is
// fire-and-forget, so it never blocks rendering or the buzzer.
void initTelemetry();

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Register the PWA service worker so the app is installable / launches
// standalone. Prod-only (dev and tests never register one), fired after load so
// it never competes with first paint or the buzzer. The worker caches nothing
// (see public/sw.js); registration is best-effort and failure is non-fatal.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability is a progressive enhancement; ignore failures */
    });
  });
}
