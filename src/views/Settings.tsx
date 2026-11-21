import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useHub } from "../hub";
import type { InstallScope } from "../types";
import { PRIVACY_URL } from "./Setup";
import { AppUpdatePanel } from "../components/AppUpdatePanel";

const REPO_URL = "https://github.com/kimmj1234/plugin-hub";

const SCOPES: { value: InstallScope; label: string; desc: string }[] = [
  { value: "user", label: "PC 전체 (기본값)", desc: "이 PC의 모든 폴더에서 쓰입니다." },
  { value: "local", label: "특정 폴더 · 나만", desc: "고른 폴더에서 나에게만 쓰입니다. (.claude/settings.local.json)" },
  { value: "project", label: "특정 폴더 · 팀 공유", desc: "고른 폴더에서 쓰이고, git으로 팀원과 공유됩니다. (.claude/settings.json)" },
];

export function Settings() {
  const { prefs, setPrefs, projects, addProject, snap, perm } = useHub();

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
        <h2>권한과 준비 상태</h2>
        <ul className="plain small">
          <li>Claude Code: {perm?.cli ? "준비됨" : "설정 필요 — 설치·삭제·업데이트를 쓸 수 없습니다"}</li>
          {perm?.os === "macos" && <li>손쉬운 사용 권한: {perm.accessibility ? "허용됨" : "설정 필요 — Claude 채팅 플러그인 자동 설치를 쓸 수 없습니다"}</li>}
          <li>Claude 앱: {perm?.desktopInstalled ? "설치됨" : "없음 — Claude 채팅 플러그인을 쓸 수 없습니다"}</li>
        </ul>
        <button onClick={() => window.dispatchEvent(new Event("hub:open-setup"))}>권한·설정 점검 열기</button>
      </section>

      <section className="settings-block">
        <h2>개인정보</h2>
        <label className="radio">
          <input type="checkbox" checked={prefs.usageConsent} onChange={(e) => setPrefs({ ...prefs, usageConsent: e.target.checked })} />
          <span>
            <strong>사용 분석</strong>
            <span className="muted small"> — 이 PC의 Claude Code 대화 기록에서 플러그인 호출 횟수만 셉니다. 대화 내용은 저장하거나 보내지 않습니다. 끄면 기록을 읽지 않습니다.</span>
          </span>
        </label>
        <p className="muted small">
          Plugin Hub는 사용 통계·광고·추적을 수집하지 않고, 개발자 서버로 아무것도 보내지 않습니다.{" "}
          <button className="link" onClick={() => openUrl(PRIVACY_URL).catch(() => {})}>개인정보 처리방침</button>
        </p>
      </section>

      <AppUpdatePanel />

      <section className="settings-block">
        <h2>계속 관리하기</h2>
        <label className="radio">
          <input type="checkbox" checked={prefs.autoUpdatePlugins} onChange={(e) => setPrefs({ ...prefs, autoUpdatePlugins: e.target.checked })} />
          <span>
            <strong>플러그인 업데이트 자동 설치</strong>
            <span className="muted small"> — Claude Code(터미널·Code 탭) 플러그인에 새 버전이 나오면 확인 없이 바로 업데이트합니다. 새 세션부터 적용됩니다.</span>
          </span>
        </label>
        <label className="radio">
          <input type="checkbox" checked={prefs.launchAtLogin} onChange={(e) => setPrefs({ ...prefs, launchAtLogin: e.target.checked })} />
          <span>
            <strong>로그인할 때 자동 실행</strong>
            <span className="muted small"> — Mac을 켜면 창 없이 뒤에서 실행되어 새 버전 확인과 경고 감지를 이어 갑니다.</span>
          </span>
        </label>
        <p className="muted small">창을 닫아도 앱은 계속 실행됩니다. 트레이(macOS는 메뉴 막대) 아이콘이나 앱 아이콘을 누르면 다시 열리고, 완전히 끄려면 트레이 메뉴의 "Plugin Hub 종료"를 누르세요(macOS는 ⌘Q도 가능).</p>
      </section>

      <section className="settings-block">
        <h2>등록된 마켓플레이스</h2>
        <p className="muted small">플러그인을 받아 오는 곳입니다. 새 마켓플레이스는 '플러그인 찾기'에서 추가합니다.</p>
        <ul className="plain small">
          {snap?.marketplaces.map((m) => (
            <li key={m.name}>
              <strong>{m.name}</strong> <span className="muted">{m.source}</span> <span className="badge">{m.pluginCount}개</span>
            </li>
          ))}
          {snap && snap.marketplaces.length === 0 && <li className="muted">등록된 마켓플레이스가 없습니다.</li>}
        </ul>
      </section>

      <section className="settings-block">
        <h2>등록한 작업 폴더</h2>
        <p className="muted small">폴더별 적용 설정은 '내 플러그인 → 폴더별 적용'에서 합니다.</p>
        <ul className="plain small">
          {projects.map((p) => <li key={p.path}>📁 {p.name} <span className="muted mono">{p.path}</span></li>)}
          {projects.length === 0 && <li className="muted">아직 없습니다.</li>}
        </ul>
      </section>
      <section className="settings-block">
        <h2>정보</h2>
        <p className="small">
          Plugin Hub는 MIT 라이선스로 공개된 개인 오픈소스 프로젝트이며 Anthropic과 관계가 없습니다. Claude와 Claude Code는 Anthropic의 상표입니다.
        </p>
        <div className="row">
          <button className="link" onClick={() => openUrl(REPO_URL).catch(() => {})}>GitHub 저장소</button>
          <button className="link" onClick={() => openUrl(`${REPO_URL}/blob/main/LICENSE`).catch(() => {})}>라이선스</button>
          <button className="link" onClick={() => api.openLicenses().catch(() => openUrl(`${REPO_URL}/blob/main/THIRD_PARTY_LICENSES.txt`).catch(() => {}))}>오픈소스 라이선스</button>
          <button className="link" onClick={() => openUrl(`${REPO_URL}/blob/main/SECURITY.md`).catch(() => {})}>보안 문제 신고</button>
        </div>
      </section>
    </div>
  );
}
