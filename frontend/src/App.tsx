import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { useAuth } from "./context/useAuth";
import { DisplayPage } from "./pages/DisplayPage";
import { HomePage } from "./pages/HomePage";
import { JoinTeamPage } from "./pages/JoinTeamPage";
import { ManagerConsolePage } from "./pages/ManagerConsolePage";
import { ManagerCreateGamePage } from "./pages/ManagerCreateGamePage";
import { ManagerLoginPage } from "./pages/ManagerLoginPage";
import { TeamGameplayPage } from "./pages/TeamGameplayPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { adminPassword } = useAuth();
  if (!adminPassword) return <Navigate to="/manager/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/join" element={<JoinTeamPage />} />
            <Route path="/join/:gameCode" element={<JoinTeamPage />} />
            <Route path="/team/:gameCode" element={<TeamGameplayPage />} />
            <Route path="/manager/login" element={<ManagerLoginPage />} />
            <Route
              path="/manager/create"
              element={
                <RequireAuth>
                  <ManagerCreateGamePage />
                </RequireAuth>
              }
            />
            <Route
              path="/manager/game/:gameCode"
              element={
                <RequireAuth>
                  <ManagerConsolePage />
                </RequireAuth>
              }
            />
            <Route path="/display" element={<DisplayPage />} />
            <Route path="/display/:gameCode" element={<DisplayPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
