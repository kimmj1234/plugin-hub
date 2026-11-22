import { useHub } from "../hub";
import { selectable } from "../a11y";
import { DiagnosticItem } from "../components/DiagnosticItem";
import { Toggle } from "../components/Toggle";
import { koFor } from "../catalogMeta";
import { alwaysOnTokens, formatTokens, recentlyInstalled, usageOf, NEW_INSTALL_DAYS } from "../cost";
import type { Plugin } from "../types";
import { SURFACE } from "../surface";

const BAR_COLORS = ["#4f46e5", "#7c7ff2", "#f59e0b", "#10b981", "#ec4899", "#0ea5e9"];

function Diet({ go }: { go: (v: "installed") => void }) {
  const { snap, usage, usageDays, usageSessions, toggle, toggleMany, prefs, setPrefs } = useHub();
  if (!snap) return null;
  const on = snap.plugins.filter((p) => p.surface === "cli" && p.enabled && p.installed);
  const costs = on.map((p) => ({ p, t: alwaysOnTokens(p) })).sort((a, b) => b.t - a.t);
  const total = costs.reduce((n, x) => n + x.t, 0);
  const top = costs.slice(0, 5);
  const rest = total - top.reduce((n, x) => n + x.t, 0);
  const neverUsed: Plugin[] = usage ? on.filter((p) => !usageOf(usage, p)?.count) : [];
  const unused = neverUsed.filter((p) => !recentlyInstalled(p));
  const fresh = neverUsed.length - unused.length;
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
        {!prefs.usageConsent ? (
          <div className="diet-unused-head">
            <div>
              <strong>어떤 플러그인을 안 쓰는지 알고 싶다면</strong>
              <div className="muted small">사용 분석을 켜면 이 PC의 Claude Code 대화 기록에서 플러그인 호출 횟수만 세어 끌 만한 플러그인을 알려 줍니다. 대화 내용은 저장하거나 보내지 않습니다.</div>
            </div>
            <button onClick={() => setPrefs({ ...prefs, usageConsent: true })}>사용 분석 켜기</button>
          </div>
        ) : !usage ? (
          <p className="muted small">최근 {usageDays}일 사용 기록을 분석하는 중…</p>
        ) : usageSessions === 0 ? (
          // 대화 기록을 하나도 못 찾았으면 "모두 안 씀"이 아니라 "판단할 기록 없음"이다. 끄라고 권하지 않는다.
          <p className="small">
            <strong>아직 판단할 사용 기록이 없습니다.</strong>{" "}
            <span className="muted">최근 {usageDays}일 동안의 Claude Code 대화 기록을 찾지 못했습니다. Claude Code를 쓰고 나면 안 쓰는 플러그인을 알려 드립니다.</span>
          </p>
        ) : unused.length === 0 ? (
          <p className="small">
            <strong>지금 끌 만한 플러그인이 없습니다.</strong>{" "}
            <span className="muted">
              {fresh > 0
                ? `최근 ${NEW_INSTALL_DAYS}일 안에 설치한 ${fresh}개는 아직 사용 기록이 없어 지켜보는 중이고, 나머지는 최근 ${usageDays}일 동안 썼습니다.`
                : `켜진 플러그인을 최근 ${usageDays}일 동안 모두 한 번 이상 썼습니다.`}
            </span>
          </p>
        ) : (
          <>
            <div className="diet-unused-head">
              <div>
                <strong>최근 {usageDays}일 동안 한 번도 안 쓴 플러그인 {unused.length}개</strong>
                <div className="muted small">
                  끄면 매 세션 약 {formatTokens(unusedCost)} 토큰을 아끼고, 엉뚱한 스킬이 불릴 일도 줄어듭니다.
                  {fresh > 0 && ` (최근 ${NEW_INSTALL_DAYS}일 안에 설치한 ${fresh}개는 제외)`}
                </div>
              </div>
              <button onClick={() => toggleMany(unused, false)}>모두 끄기</button>
            </div>
            <ul className="diet-list">
              {unused.map((p) => (
                <li key={p.id}>
                  <div className="pl-main">
                    <div className="pl-name">{p.displayName}</div>
                    <div className="pl-desc">{koFor(p) || p.description}</div>
                  </div>
                  <span className="muted small">~{formatTokens(alwaysOnTokens(p))}</span>
                  <Toggle checked={p.enabled} disabled={!p.toggleable || p.folderMissing || !!snap.settingsError} onChange={(v) => toggle(p, v)} label={`${p.displayName} 켜기/끄기`} />
                </li>
              ))}
            </ul>
          </>
        )}
        {prefs.usageConsent && <p className="muted tiny">
          이 PC의 Claude Code 대화 기록 {usageSessions}개에서 스킬·명령·에이전트·MCP 호출만 셉니다. 대화 내용은 저장하거나 보내지 않습니다. Claude 앱 채팅에서 쓴 기록은 포함되지 않습니다.
        </p>}
      </div>
    </section>
  );
}

export type HomeTarget = "plugins" | "discover";

export function Dashboard({ go }: { go: (v: HomeTarget) => void }) {
  const { snap, refresh } = useHub();
  if (!snap) return null;
  const { env } = snap;
  const cli = snap.plugins.filter((p) => p.surface === "cli");
  const desk = snap.plugins.filter((p) => p.surface === "desktop");
  const problems = snap.diagnostics.filter((d) => d.severity !== "info");
  const infos = snap.diagnostics.filter((d) => d.severity === "info");

  return (
    <div className="page">
      <h1>홈</h1>

      {snap.settingsError && <div className="note bad">{snap.settingsError}</div>}

      <Diet go={() => go("plugins")} />

      <h2>
        점검 결과
        <button className="link" onClick={refresh}>다시 검사</button>
      </h2>
      <p className="muted small">
        설정 파일이 바뀔 때마다 자동으로 다시 검사합니다. 마지막 검사: {new Date(snap.scannedAt).toLocaleTimeString()}
      </p>
      {problems.length === 0 ? (
        <div className="note ok">고쳐야 할 문제가 없습니다.</div>
      ) : (
        problems.map((d) => <DiagnosticItem key={d.id} d={d} />)
      )}
      {infos.length > 0 && (
        <details className="fold">
          <summary>참고할 안내 {infos.length}건 (업데이트, 자동 실행 훅 등)</summary>
          {infos.map((d) => <DiagnosticItem key={d.id} d={d} />)}
        </details>
      )}
      <details className="fold">
        <summary className="muted">어떤 것을 검사하나요? (규칙 14개)</summary>
        <ul className="plain small">
          <li>켜져 있지만 설치되지 않은 플러그인 (설정 찌꺼기) — 자동 정리</li>
          <li>설치 폴더가 사라졌거나 plugin.json이 손상된 플러그인 — 다시 설치</li>
          <li>출처 마켓플레이스가 등록되어 있지 않은 플러그인</li>
          <li>마켓플레이스에 새 버전이 있는 플러그인 — 업데이트</li>
          <li>같은 플러그인이 여러 마켓플레이스에서 동시에 켜진 경우</li>
          <li>여러 플러그인에 같은 이름의 스킬·명령이 있어 충돌할 수 있는 경우</li>
          <li>켜진 플러그인이 너무 많아 매 세션 컨텍스트 비용이 커지는 경우</li>
          <li>세션마다 스크립트를 자동 실행하는 훅이 있는 플러그인</li>
          <li>Claude 앱과 터미널 양쪽에서 같은 플러그인을 켠 경우</li>
          <li>settings.json·폴더 설정 파일 형식 오류, 설치 기록을 읽을 수 없는 경우</li>
          <li>등록한 폴더가 사라졌거나, 폴더 설정에서만 켜지고 설치되지 않은 플러그인</li>
        </ul>
      </details>

      <h2>이 Mac의 Claude</h2>
      <div className="cards">
        <div className="card">
          <div className="card-label" title={SURFACE.cli.hint}>Claude Code · {SURFACE.cli.where}</div>
          {env.terminalCli ? (
            <div className="card-value ok">설치됨 {env.terminalCli.version && `v${env.terminalCli.version}`}</div>
          ) : (
            <>
              <div className="card-value dim">터미널용 없음</div>
              <div className="muted small">
                {env.activeCli ? "설치·업데이트는 Claude 앱에 들어 있는 Claude Code로 합니다." : "설치하려면 Claude Code나 Claude 앱이 필요합니다."}
              </div>
            </>
          )}
          <div className="card-foot">
            플러그인 {cli.length}개 · 켜짐 {cli.filter((p) => p.enabled).length}개
          </div>
        </div>
        <div className="card">
          <div className="card-label" title={SURFACE.desktop.hint}>Claude 채팅 · {SURFACE.desktop.where}</div>
          {env.desktopInstalled ? <div className="card-value ok">설치됨</div> : <div className="card-value dim">설치되지 않음</div>}
          <div className="card-foot">
            계정 플러그인 {desk.length}개 · 켜짐 {desk.filter((p) => p.enabled).length}개
          </div>
        </div>
        <div className="card clickable" role="button" {...selectable(() => go("discover"), false)}>
          <div className="card-label">새 플러그인</div>
          <div className="card-value">찾아보기 →</div>
          <div className="muted small">용도별 인기 플러그인과 한국어 설명</div>
        </div>
      </div>

      <details className="note">
        <summary>
          <strong>Claude Code 플러그인과 Claude 채팅 플러그인은 뭐가 다른가요?</strong>
        </summary>
        <strong>Claude Code</strong>: 터미널의 Claude Code와 Claude 앱의 Code 탭은 같은 <code className="mono">{env.claudeHome}</code> 폴더를 함께 씁니다. 한쪽에 설치하면 양쪽에서 쓰입니다.
        <br />
        <strong>Claude 채팅</strong>: Claude 앱의 채팅·Cowork 플러그인은 Claude 계정에 저장되어 기기 사이에 동기화됩니다. 같은 이름이어도 Claude Code 쪽과는 따로 설치됩니다.
      </details>
    </div>
  );
}
