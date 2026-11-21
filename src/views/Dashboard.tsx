import { useHub } from "../hub";
import { DiagnosticItem } from "../components/DiagnosticItem";
import { Toggle } from "../components/Toggle";
import { koDescription } from "../catalogMeta";
import { alwaysOnTokens, formatTokens } from "../cost";
import type { Plugin } from "../types";

const BAR_COLORS = ["#4f46e5", "#7c7ff2", "#f59e0b", "#10b981", "#ec4899", "#0ea5e9"];

function Diet({ go }: { go: (v: "installed") => void }) {
  const { snap, usage, usageDays, usageSessions, toggle, toggleMany } = useHub();
  if (!snap) return null;
  const on = snap.plugins.filter((p) => p.surface === "cli" && p.enabled && p.installed);
  const costs = on.map((p) => ({ p, t: alwaysOnTokens(p) })).sort((a, b) => b.t - a.t);
  const total = costs.reduce((n, x) => n + x.t, 0);
  const top = costs.slice(0, 5);
  const rest = total - top.reduce((n, x) => n + x.t, 0);
  const unused: Plugin[] = usage ? on.filter((p) => !usage[p.name]?.count) : [];
  const unusedCost = unused.reduce((n, p) => n + alwaysOnTokens(p), 0);
  const mcp = on.filter((p) => p.components.mcpServers.length).length;

  return (
    <section className="diet">
      <div className="diet-head">
        <div>
          <div className="card-label">켜진 플러그인이 매 세션 차지하는 컨텍스트</div>
          <div className="diet-total">
            약 {formatTokens(total)} <span>토큰</span>
          </div>
          <div className="muted small">
            터미널·Code 탭 플러그인 {on.length}개 기준 추정값{mcp ? ` · MCP 서버가 있는 ${mcp}개는 도구 설명이 더 붙습니다` : ""}
          </div>
        </div>
        <button className="link" onClick={() => go("installed")}>플러그인 목록</button>
      </div>
      {total > 0 && (
        <>
          <div className="diet-bar" role="img" aria-label="플러그인별 컨텍스트 비중">
            {top.map((x, i) => (
              <span key={x.p.id} style={{ flex: x.t, background: BAR_COLORS[i] }} title={`${x.p.displayName} 약 ${x.t} 토큰`} />
            ))}
            {rest > 0 && <span style={{ flex: rest, background: "var(--line)" }} title={`그 외 약 ${rest} 토큰`} />}
          </div>
          <ul className="diet-legend">
            {top.map((x, i) => (
              <li key={x.p.id}>
                <i style={{ background: BAR_COLORS[i] }} />
                {x.p.displayName} <span className="muted">{formatTokens(x.t)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="diet-unused">
        {!usage ? (
          <p className="muted small">최근 {usageDays}일 사용 기록을 분석하는 중…</p>
        ) : unused.length === 0 ? (
          <p className="small">
            <strong>모두 잘 쓰고 있습니다.</strong>{" "}
            <span className="muted">최근 {usageDays}일 동안 켜진 플러그인을 모두 한 번 이상 썼습니다.</span>
          </p>
        ) : (
          <>
            <div className="diet-unused-head">
              <div>
                <strong>최근 {usageDays}일 동안 한 번도 안 쓴 플러그인 {unused.length}개</strong>
                <div className="muted small">끄면 매 세션 약 {formatTokens(unusedCost)} 토큰을 아끼고, 엉뚱한 스킬이 불릴 일도 줄어듭니다.</div>
              </div>
              <button onClick={() => toggleMany(unused, false)}>모두 끄기</button>
            </div>
            <ul className="diet-list">
              {unused.map((p) => (
                <li key={p.id}>
                  <div className="pl-main">
                    <div className="pl-name">{p.displayName}</div>
                    <div className="pl-desc">{koDescription(p.id) || p.description}</div>
                  </div>
                  <span className="muted small">~{formatTokens(alwaysOnTokens(p))}</span>
                  <Toggle checked={p.enabled} disabled={!p.toggleable || !!snap.settingsError} onChange={(v) => toggle(p, v)} label={`${p.displayName} 켜기/끄기`} />
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted tiny">
          이 Mac의 Claude Code 대화 기록 {usageSessions}개에서 스킬·명령·에이전트·MCP 호출만 셉니다. 대화 내용은 저장하거나 보내지 않습니다. Claude 앱 채팅에서 쓴 기록은 포함되지 않습니다.
        </p>
      </div>
    </section>
  );
}

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

      <Diet go={go} />

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

      <details className="note">
        <summary>
          <strong>터미널 플러그인과 Claude 앱 플러그인은 뭐가 다른가요?</strong>
        </summary>
        터미널과 Claude 앱의 Code 탭은 같은 <code className="mono">{env.claudeHome}</code> 설정을 함께 씁니다. Claude 앱의 채팅·Cowork 플러그인은 계정에 동기화되어 따로 관리됩니다.
      </details>

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
