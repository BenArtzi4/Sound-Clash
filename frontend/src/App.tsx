import { lazy, Suspense } from "react";
import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RouteFallback } from "./components/RouteFallback";
import { RouteHead } from "./components/RouteHead";
import { ScrollToTop } from "./components/ScrollToTop";
import { ViewTracker } from "./components/ViewTracker";
import { ToastProvider } from "./context/ToastContext";
import { seo } from "./lib/routeHead";
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
const PrivacyPage = lazy(() =>
  import("./pages/PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
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
// The search landing pages (/guess-the-song-game and friends) share one
// component and one lazy chunk; their routes come from src/seo/pages.json so a
// new page is a pages.json entry plus its text in src/seo/landingContent.ts.
const LandingPage = lazy(() =>
  import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const LANDING_PATHS = seo.pages.filter((p) => p.landing).map((p) => p.path);

// Everything inside the router. The build renders this same tree under a
// StaticRouter (src/entry-server.tsx) to write each content page's HTML, and
// main.tsx hydrates that HTML with <App />, so the two must stay one tree: a
// wrapper that adds a DOM node here and not there would make React throw the
// server markup away (src/entry-server.test.tsx catches that).
export function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <RouteHead />
      <ViewTracker />
      <ToastProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/how-to-play" element={<HowToPlayPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            {LANDING_PATHS.map((path) => (
              <Route key={path} path={path} element={<LandingPage path={path} />} />
            ))}
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
    </>
  );
}

export function App() {
  return (
    // ErrorBoundary is the outermost wrapper so a failed lazy-route chunk import
    // after a mid-game deploy (or any render crash) shows a "Reload" screen
    // instead of a blank page. See lib/preloadError.ts for the auto-reload path.
    <ErrorBoundary>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
