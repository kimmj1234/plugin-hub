import { useEffect, useState } from "react";
import type { Toast } from "./hub";
import { HubProvider, PRIVACY_VERSION, useHub } from "./hub";
import { Setup } from "./views/Setup";
import { UpdateStatus } from "./components/AppUpdatePanel";
import { IS_WINDOWS, checkForUpdate, downloadUpdate, installDownloaded, installUpdate } from "./updater";
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

const TOAST_LABEL: Record<Toast["kind"], string> = { ok: "완료", error: "오류", warning: "주의", info: "알림" };

/** 알림: 오류·주의는 화면 읽기 프로그램이 바로 읽고(alert), 닫기 버튼으로 키보드로도 닫을 수 있다 */
function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" || t.kind === "warning" ? "alert" : "status"}>
          <span className="toast-kind">{TOAST_LABEL[t.kind]}</span>
          <span className="toast-text">{t.text}</span>
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="알림 닫기">×</button>
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const { snap, loading, loadError, toasts, dismissToast, refresh, prefs, prefsLoaded, stateError, reloadState } = useHub();
  const [setupOpen, setSetupOpen] = useState(false);
  useEffect(() => {
    const open = () => setSetupOpen(true);
    window.addEventListener("hub:open-setup", open);
    return () => window.removeEventListener("hub:open-setup", open);
  }, []);
  const needSetup = prefsLoaded && (!prefs.onboardingDone || prefs.privacyAck < PRIVACY_VERSION);

  // 앱 업데이트: 시작 15초 뒤 한 번, 이후 6시간마다 확인. "auto"면 바로 내려받아 설치한다.
  useEffect(() => {
    if (!prefsLoaded || needSetup || prefs.appUpdate === "off") return;
    const run = async () => {
      const s = await checkForUpdate();
      if (s.kind === "available" && prefs.appUpdate === "auto") {
        if (IS_WINDOWS) await downloadUpdate();
        else await installUpdate();
      }
    };
    const first = setTimeout(run, 15_000);
    const timer = setInterval(run, 6 * 60 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [prefsLoaded, needSetup, prefs.appUpdate]);

  // Windows: 내려받아 둔 업데이트는 창을 닫아 화면에서 사라질 때 설치한다 (작업 중에 앱이 닫히지 않게)
  useEffect(() => {
    if (!IS_WINDOWS) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") installDownloaded();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  const [view, setView] = useState<View>("home");
  const [pluginsTab, setPluginsTab] = useState<PluginsTab>("list");
  // '플러그인 찾기'에서 설치한 뒤 '내 플러그인에서 열기'를 누르면 그 플러그인을 골라 둔다
  const [focusPlugin, setFocusPlugin] = useState<string | null>(null);
  const problems = snap?.diagnostics.filter((d) => d.severity !== "info").length ?? 0;
  const cliCount = snap?.plugins.filter((p) => p.surface === "cli").length ?? 0;

  const nav: { key: View; label: string; badge?: number; bad?: boolean }[] = [
    { key: "home", label: "홈", badge: problems || undefined, bad: problems > 0 },
    { key: "plugins", label: "내 플러그인", badge: cliCount },
    { key: "discover", label: "플러그인 찾기" },
    { key: "settings", label: "설정" },
  ];

  if (stateError) {
    return (
      <div className="page state-error">
        <h2>앱 설정을 읽지 못했습니다</h2>
        <p className="note bad">{stateError}</p>
        <p className="muted">등록한 폴더와 설정을 지키기 위해, 읽을 수 있을 때까지 아무것도 바꾸지 않습니다. 잠시 후 다시 시도하세요.</p>
        <button className="primary" onClick={reloadState}>다시 시도</button>
      </div>
    );
  }

  if (needSetup || setupOpen) {
    return (
      <>
        <Setup reopen={!needSetup} onDone={() => setSetupOpen(false)} />
        <Toasts toasts={toasts} dismiss={dismissToast} />
      </>
    );
  }

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
          <UpdateStatus compact />
          {snap?.watcherOk === false ? (
            <span title="설정 파일 변경을 자동으로 감지하지 못하고 있습니다. 창으로 돌아올 때마다 다시 검사합니다.">
              <span className="live-dot off" /> 실시간 감시 꺼짐
            </span>
          ) : (
            <>
              <span className="live-dot" /> 실시간 감시 중
            </>
          )}
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
        {snap && view === "plugins" && <MyPlugins tab={pluginsTab} setTab={setPluginsTab} focus={focusPlugin} />}
        {snap && view === "settings" && <Settings />}
        {snap && view === "discover" && <Discover openInstalled={(id) => { setFocusPlugin(id); setPluginsTab("list"); setView("plugins"); }} />}
      </main>

      <Toasts toasts={toasts} dismiss={dismissToast} />
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
