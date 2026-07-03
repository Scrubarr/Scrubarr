import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell.jsx";
import CleanupRules from "./pages/CleanupRules.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Exclusions from "./pages/Exclusions.jsx";
import Logs from "./pages/Logs.jsx";
import Safety from "./pages/Safety.jsx";
import Scheduler from "./pages/Scheduler.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/cleanup" element={<CleanupRules />} />
        <Route path="/exclusions" element={<Exclusions />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
