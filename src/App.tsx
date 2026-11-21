import { useState } from "react";
import { HubProvider, useHub } from "./hub";
import { Dashboard } from "./views/Dashboard";
import { Discover } from "./views/Discover";
import { MyPlugins, type PluginsTab } from "./views/MyPlugins";
import { Settings } from "./views/Settings";
import "./App.css";

type View = "home" | "plugins" | "discover" | "settings";

const ICONS: Record<View, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  plugins: "M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5",
  discover: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.5-4.5",
  settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4",
};

function Shell() {
  const { snap, loading, loadError, toasts, dismissToast, refresh, catalog } = useHub();
  const [view, setView] = useState<View>("home");
  const [pluginsTab, setPluginsTab] = useState<PluginsTab>("list");
  const problems = snap?.diagnostics.filter((d) => d.severity !== "info").length ?? 0;
  const cliCount = snap?.plugins.filter((p) => p.surface === "cli").length ?? 0;
  const freshCount = catalog?.entries.filter((e) => e.isNew || e.updated).length ?? 0;

  const nav: { key: View; label: string; badge?: number; bad?: boolean }[] = [
    { key: "home", label: "홈", badge: problems || undefined, bad: problems > 0 },
    { key: "plugins", label: "내 플러그인", badge: cliCount },
    { key: "discover", label: "플러그인 찾기", badge: freshCount || undefined },
    { key: "settings", label: "설정" },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="logo" src="/icon.png" alt="" width="22" height="22" /> Plugin Hub
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.key} className={view === n.key ? "active" : ""} onClick={() => setView(n.key)} aria-current={view === n.key ? "page" : undefined}>
              <span className="nav-label">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ICONS[n.key]} />
                </svg>
                {n.label}
              </span>
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
        {snap && view === "home" && <Dashboard go={(v) => { if (v === "plugins") setPluginsTab("list"); setView(v); }} />}
        {snap && view === "plugins" && <MyPlugins tab={pluginsTab} setTab={setPluginsTab} />}
        {snap && view === "settings" && <Settings />}
        {snap && view === "discover" && <Discover />}
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
