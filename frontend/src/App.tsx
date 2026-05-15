import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import { HomePage } from "./pages/HomePage";
import { JoinTeamPage } from "./pages/JoinTeamPage";

// Eager pages above: direct-URL entry points (the bare home, the QR-coded
// /join/:code link that players hit straight from their phone). Everything
// below is reached via in-app navigation or a less-common direct URL, so
// Vite can ship them as separate chunks and keep the initial bundle small.
// Players on slow phones download just the home / join shell up front.
const HowToPlayPage = lazy(() =>
  import("./pages/HowToPlayPage").then((m) => ({ default: m.HowToPlayPage })),
);
const TeamGameplayPage = lazy(() =>
  import("./pages/TeamGameplayPage").then((m) => ({ default: m.TeamGameplayPage })),
);
const ManagerCreateGamePage = lazy(() =>
  import("./pages/ManagerCreateGamePage").then((m) => ({ default: m.ManagerCreateGamePage })),
);
const ManagerConsolePage = lazy(() =>
  import("./pages/ManagerConsolePage").then((m) => ({ default: m.ManagerConsolePage })),
);
const AdminSongsPage = lazy(() =>
  import("./pages/AdminSongsPage").then((m) => ({ default: m.AdminSongsPage })),
);
const DisplayPage = lazy(() =>
  import("./pages/DisplayPage").then((m) => ({ default: m.DisplayPage })),
);

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/how-to-play" element={<HowToPlayPage />} />
            <Route path="/join" element={<JoinTeamPage />} />
            <Route path="/join/:gameCode" element={<JoinTeamPage />} />
            <Route path="/team/:gameCode" element={<TeamGameplayPage />} />
            <Route path="/manager/create" element={<ManagerCreateGamePage />} />
            <Route path="/manager/game/:gameCode" element={<ManagerConsolePage />} />
            <Route path="/admin/songs" element={<AdminSongsPage />} />
            <Route path="/display" element={<DisplayPage />} />
            <Route path="/display/:gameCode" element={<DisplayPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  );
}
