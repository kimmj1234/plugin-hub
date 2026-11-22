import { useEffect, useState } from "react";
import { useHub } from "../hub";
import type { Prefs } from "../types";
import { IS_WINDOWS, appVersion, checkForUpdate, installDownloaded, installUpdate, restartNow, useUpdateState } from "../updater";

/// 설정 화면의 "앱 업데이트" 구역
export function AppUpdatePanel() {
  const { prefs, setPrefs } = useHub();
  const st = useUpdateState();
  const [version, setVersion] = useState("");
  useEffect(() => {
    appVersion().then(setVersion);
  }, []);

  return (
    <section className="settings-block">
      <h2>앱 업데이트</h2>
      <p className="small">
        현재 버전 <strong>v{version || "?"}</strong>
        {st.kind === "latest" && <span className="muted"> · 최신 버전입니다</span>}
        {st.kind === "checking" && <span className="muted"> · 확인 중…</span>}
      </p>
      {([
        ["auto", "자동으로 받아 설치 (권장)", IS_WINDOWS ? "새 버전을 미리 내려받아 두고, 창을 닫을 때 설치합니다." : "새 버전을 내려받아 설치하고, 다시 시작하면 적용됩니다."],
        ["notify", "알림만", "새 버전이 있으면 알려 주고, 누르면 설치합니다."],
        ["off", "확인하지 않음", "아래 버튼으로 직접 확인할 때만 찾습니다."],
      ] as const).map(([v, label, desc]) => (
        <label key={v} className="radio">
          <input type="radio" name="appUpdate" checked={prefs.appUpdate === v} onChange={() => setPrefs({ ...prefs, appUpdate: v as Prefs["appUpdate"] })} />
          <span><strong>{label}</strong><span className="muted small"> — {desc}</span></span>
        </label>
      ))}
      <UpdateStatus />
      {st.kind !== "available" && st.kind !== "downloading" && st.kind !== "downloaded" && st.kind !== "ready" && (
        <button onClick={() => checkForUpdate()} disabled={st.kind === "checking"}>지금 확인</button>
      )}
      <p className="muted small">업데이트는 GitHub Releases에서 받고, 개발자 서명이 맞을 때만 설치합니다. 다시 내려받거나 설치 프로그램을 실행할 필요가 없습니다.</p>
    </section>
  );
}

/// 업데이트 상태와 버튼 (설정 화면, 사이드바에서 함께 쓴다)
export function UpdateStatus({ compact }: { compact?: boolean }) {
  const st = useUpdateState();
  if (st.kind === "available")
    return (
      <div className={compact ? "update-pill" : "note"}>
        <strong>새 버전 v{st.version}</strong>
        {!compact && st.notes && <p className="small update-notes">{st.notes}</p>}
        <button className="primary" onClick={() => installUpdate()}>지금 설치</button>
      </div>
    );
  if (st.kind === "downloading")
    return <div className={compact ? "update-pill" : "note"}>v{st.version} 내려받는 중{st.percent !== null ? ` ${st.percent}%` : "…"}</div>;
  if (st.kind === "downloaded")
    return (
      <div className={compact ? "update-pill" : "note"}>
        <strong>v{st.version} 준비됨</strong>
        {!compact && <p className="small">창을 닫으면 자동으로 설치되고, 지금 설치하면 앱이 잠시 닫혔다가 다시 열립니다.</p>}
        <button className="primary" onClick={() => installDownloaded()}>지금 설치</button>
      </div>
    );
  if (st.kind === "ready")
    return (
      <div className={compact ? "update-pill" : "note ok"}>
        <strong>v{st.version} 설치 완료</strong>
        <button className="primary" onClick={() => restartNow()}>다시 시작</button>
      </div>
    );
  if (st.kind === "error")
    return compact ? (
      // 사이드바에서도 실패를 알 수 있게 짧게 표시하고, 자세한 이유는 마우스를 올리면 보인다
      <div className="update-pill error" title={st.message}>앱 업데이트 확인 실패 · 설정에서 다시 시도</div>
    ) : (
      <div className="note bad small">{st.message}</div>
    );
  return null;
}
