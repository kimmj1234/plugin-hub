import { useHub } from "../hub";
import { DiagnosticItem } from "../components/DiagnosticItem";

export function Dashboard({ go }: { go: (v: "installed" | "scopes" | "commands" | "discover" | "diagnostics" | "settings") => void }) {
  const { snap } = useHub();
  if (!snap) return null;
  const { env } = snap;
  const cli = snap.plugins.filter((p) => p.surface === "cli");
  const desk = snap.plugins.filter((p) => p.surface === "desktop");
  const problems = snap.diagnostics.filter((d) => d.severity !== "info");

  return (
    <div className="page">
      <h1>대시보드</h1>

      <div className="cards">
        <div className="card">
          <div className="card-label">터미널 · Claude Code CLI</div>
          {env.terminalCli ? (
            <>
              <div className="card-value ok">설치됨 {env.terminalCli.version && `v${env.terminalCli.version}`}</div>
              <div className="muted mono small">{env.terminalCli.path}</div>
            </>
          ) : (
            <>
              <div className="card-value dim">터미널용 CLI 없음</div>
              <div className="muted small">
                {env.activeCli ? "설치·업데이트는 Claude 앱 내장 Claude Code로 실행합니다." : "설치 기능을 쓰려면 Claude Code나 Claude 앱이 필요합니다."}
              </div>
            </>
          )}
          <div className="card-foot">
            플러그인 {cli.length}개 · 켜짐 {cli.filter((p) => p.enabled).length}개
          </div>
        </div>

        <div className="card">
          <div className="card-label">Claude 앱 (데스크톱)</div>
          {env.desktopInstalled ? (
            <>
              <div className="card-value ok">설치됨</div>
              <div className="muted small">
                내장 Claude Code {env.desktopBundledVersions[0] ? `v${env.desktopBundledVersions[0]}` : "없음"}
              </div>
            </>
          ) : (
            <div className="card-value dim">설치되지 않음</div>
          )}
          <div className="card-foot">
            계정 동기화 플러그인 {desk.length}개 · 켜짐 {desk.filter((p) => p.enabled).length}개
          </div>
        </div>

        <div className="card clickable" onClick={() => go("diagnostics")}>
          <div className="card-label">진단</div>
          <div className={`card-value ${problems.length ? "bad" : "ok"}`}>
            {problems.length ? `문제 ${problems.length}건` : "문제 없음"}
          </div>
          <div className="muted small">설정 파일이 바뀔 때마다 자동으로 다시 검사합니다.</div>
          <div className="card-foot">안내 {snap.diagnostics.length - problems.length}건</div>
        </div>
      </div>

      <div className="note">
        <strong>앱 버전과 터미널 버전의 차이</strong>
        <br />
        터미널과 Claude 앱의 Code 탭은 같은 <code className="mono">{env.claudeHome}</code> 설정을 함께 씁니다. Claude 앱의 채팅·Cowork 플러그인은 계정에 동기화되어 따로 관리됩니다.
      </div>

      {snap.settingsError && <div className="note bad">{snap.settingsError}</div>}

      <h2>
        확인이 필요한 항목
        <button className="link" onClick={() => go("diagnostics")}>모두 보기</button>
      </h2>
      {problems.length === 0 ? (
        <p className="muted">오류나 경고가 없습니다.</p>
      ) : (
        problems.slice(0, 5).map((d) => <DiagnosticItem key={d.id} d={d} />)
      )}

      <h2>
        마켓플레이스 {snap.marketplaces.length}개
        <button className="link" onClick={() => go("discover")}>플러그인 찾기</button>
      </h2>
      <ul className="plain">
        {snap.marketplaces.map((m) => (
          <li key={m.name}>
            <strong>{m.name}</strong> <span className="muted">{m.source}</span>{" "}
            <span className="badge">{m.pluginCount}개</span>
          </li>
        ))}
        {snap.marketplaces.length === 0 && <li className="muted">등록된 마켓플레이스가 없습니다.</li>}
      </ul>
    </div>
  );
}
