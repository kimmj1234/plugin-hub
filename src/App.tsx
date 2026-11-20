import { useState } from "react";
import { HubProvider, useHub } from "./hub";
import { Dashboard } from "./views/Dashboard";
import { Installed } from "./views/Installed";
import { Discover } from "./views/Discover";
import { Diagnostics } from "./views/Diagnostics";
import { Commands } from "./views/Commands";
import "./App.css";

type View = "dashboard" | "installed" | "commands" | "discover" | "diagnostics";

function Shell() {
  const { snap, loading, loadError, toasts, dismissToast, refresh, catalog } = useHub();
  const [view, setView] = useState<View>("dashboard");
  const problems = snap?.diagnostics.filter((d) => d.severity !== "info").length ?? 0;
  const cliCount = snap?.plugins.filter((p) => p.surface === "cli").length ?? 0;
  const freshCount = catalog?.entries.filter((e) => e.isNew || e.updated).length ?? 0;

  const nav: { key: View; label: string; badge?: number; bad?: boolean }[] = [
    { key: "dashboard", label: "대시보드" },
    { key: "installed", label: "설치된 플러그인", badge: cliCount },
    { key: "commands", label: "슬래시 명령" },
    { key: "discover", label: "플러그인 찾기", badge: freshCount || undefined },
    { key: "diagnostics", label: "진단", badge: problems || undefined, bad: problems > 0 },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">◆</span> Plugin Hub
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""} onClick={() => setView(n.key)}>
              {n.label}
              {n.badge !== undefined && <span className={`count ${n.bad ? "bad" : ""}`}>{n.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="live-dot" /> 실시간 감시 중
          {snap && <div className="muted small">{new Date(snap.scannedAt).toLocaleTimeString()} 갱신</div>}
        </div>
      </aside>

      <main className="main">
        {loading && <div className="empty">플러그인을 검사하는 중…</div>}
        {loadError && (
          <div className="page">
            <div className="note bad">검사 실패: {loadError}</div>
            <button onClick={refresh}>다시 시도</button>
          </div>
        )}
        {snap && view === "dashboard" && <Dashboard go={setView} />}
        {snap && view === "installed" && <Installed />}
        {snap && view === "commands" && <Commands />}
        {snap && view === "discover" && <Discover />}
        {snap && view === "diagnostics" && <Diagnostics />}
      </main>

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <HubProvider>
      <Shell />
    </HubProvider>
  );
}
