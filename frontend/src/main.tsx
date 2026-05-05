import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { env } from "./lib/env";
import "./styles.css";

if (env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: env.VITE_SENTRY_DSN, tracesSampleRate: 0 });
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
