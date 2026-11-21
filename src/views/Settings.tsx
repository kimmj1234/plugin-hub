import { api } from "../api";
import { useHub } from "../hub";
import type { InstallScope } from "../types";

const SCOPES: { value: InstallScope; label: string; desc: string }[] = [
  { value: "user", label: "PC 전체 (기본값)", desc: "이 PC의 모든 폴더에서 쓰입니다." },
  { value: "local", label: "특정 폴더 · 나만", desc: "고른 폴더에서 나에게만 쓰입니다. (.claude/settings.local.json)" },
  { value: "project", label: "특정 폴더 · 팀 공유", desc: "고른 폴더에서 쓰이고, git으로 팀원과 공유됩니다. (.claude/settings.json)" },
];

export function Settings() {
  const { prefs, setPrefs, projects, addProject } = useHub();

  const pickAndSet = async () => {
    const path = await api.pickFolder();
    if (!path) return;
    if (!(await addProject(path))) return;
    setPrefs({ ...prefs, defaultInstallProject: path });
  };

  return (
    <div className="page">
      <h1>설정</h1>

      <section className="settings-block">
        <h2>새로 설치할 때 기본 적용 범위</h2>
        <p className="muted small">플러그인 찾기에서 설치할 때 처음 선택되어 있는 범위입니다. 설치 창에서 매번 바꿀 수 있습니다.</p>
        {SCOPES.map((s) => (
          <label key={s.value} className="radio">
            <input
              type="radio"
              name="scope"
              checked={prefs.defaultInstallScope === s.value}
              onChange={() => setPrefs({ ...prefs, defaultInstallScope: s.value })}
            />
            <span>
              <strong>{s.label}</strong>
              <span className="muted small"> — {s.desc}</span>
            </span>
          </label>
        ))}
        {prefs.defaultInstallScope !== "user" && (
          <div className="row indent">
            <select
              value={prefs.defaultInstallProject ?? ""}
              onChange={(e) => setPrefs({ ...prefs, defaultInstallProject: e.target.value || null })}
              aria-label="기본 폴더"
            >
              <option value="">폴더 선택…</option>
              {projects.map((p) => <option key={p.path} value={p.path}>{p.name}</option>)}
            </select>
            <button onClick={pickAndSet}>다른 폴더 고르기</button>
          </div>
        )}
      </section>

      <section className="settings-block">
        <h2>새 플러그인·업데이트 자동 확인</h2>
        <p className="muted small">마켓플레이스 원본을 주기적으로 다시 받아 새로 생긴 플러그인과 업데이트를 표시합니다. 로컬 파일 변경은 이 설정과 관계없이 항상 바로 반영됩니다.</p>
        <select value={prefs.remoteRefreshMinutes} onChange={(e) => setPrefs({ ...prefs, remoteRefreshMinutes: Number(e.target.value) })} aria-label="자동 확인 주기">
          <option value={0}>끄기</option>
          <option value={15}>15분마다</option>
          <option value={30}>30분마다 (기본)</option>
          <option value={60}>1시간마다</option>
          <option value={180}>3시간마다</option>
        </select>
      </section>

      <section className="settings-block">
        <h2>계속 관리하기</h2>
        <label className="radio">
          <input type="checkbox" checked={prefs.autoUpdatePlugins} onChange={(e) => setPrefs({ ...prefs, autoUpdatePlugins: e.target.checked })} />
          <span>
            <strong>플러그인 업데이트 자동 설치</strong>
            <span className="muted small"> — 터미널·Claude Code 플러그인에 새 버전이 나오면 확인 없이 바로 업데이트합니다. 새 세션부터 적용됩니다.</span>
          </span>
        </label>
        <label className="radio">
          <input type="checkbox" checked={prefs.launchAtLogin} onChange={(e) => setPrefs({ ...prefs, launchAtLogin: e.target.checked })} />
          <span>
            <strong>로그인할 때 자동 실행</strong>
            <span className="muted small"> — Mac을 켜면 창 없이 뒤에서 실행되어 새 버전 확인과 경고 감지를 이어 갑니다.</span>
          </span>
        </label>
        <p className="muted small">창을 닫아도 앱은 계속 실행됩니다. Dock 아이콘을 누르면 다시 열리고, 완전히 끄려면 ⌘Q를 누르세요.</p>
      </section>

      <section className="settings-block">
        <h2>등록한 작업 폴더</h2>
        <p className="muted small">폴더별 적용 설정은 '적용 범위' 화면에서 합니다.</p>
        <ul className="plain small">
          {projects.map((p) => <li key={p.path}>📁 {p.name} <span className="muted mono">{p.path}</span></li>)}
          {projects.length === 0 && <li className="muted">아직 없습니다.</li>}
        </ul>
      </section>
    </div>
  );
}
