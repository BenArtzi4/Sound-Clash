import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import { DisplayPage } from "./pages/DisplayPage";
import { HomePage } from "./pages/HomePage";
import { JoinTeamPage } from "./pages/JoinTeamPage";
import { ManagerConsolePage } from "./pages/ManagerConsolePage";
import { ManagerCreateGamePage } from "./pages/ManagerCreateGamePage";
import { TeamGameplayPage } from "./pages/TeamGameplayPage";

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join" element={<JoinTeamPage />} />
          <Route path="/join/:gameCode" element={<JoinTeamPage />} />
          <Route path="/team/:gameCode" element={<TeamGameplayPage />} />
          <Route path="/manager/create" element={<ManagerCreateGamePage />} />
          <Route path="/manager/game/:gameCode" element={<ManagerConsolePage />} />
          <Route path="/display" element={<DisplayPage />} />
          <Route path="/display/:gameCode" element={<DisplayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
