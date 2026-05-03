// Phase 1 placeholder. Real router + providers in Phase 5 per docs/api-contracts.md.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <h1>Sound Clash — Phase 1 scaffold</h1>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
