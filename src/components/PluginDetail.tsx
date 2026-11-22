import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorText } from "../api";
import { useHub } from "../hub";
import type { Plugin } from "../types";
import { koFor } from "../catalogMeta";
import { Markdown } from "./Markdown";
import { Toggle } from "./Toggle";
import { DiagnosticItem } from "./DiagnosticItem";
import { GuidePanel } from "./GuidePanel";
import { SlashHelp, SlashRow, slashItems } from "./SlashCommands";
import { ScopeEditor } from "./ScopeEditor";
import { AppUsage } from "./AppUsage";
import { alwaysOnTokens, formatTokens, recentlyInstalled, tokenWeight, usageLabel, usageOf } from "../cost";
import { SURFACE } from "../surface";

export function PluginDetail({ plugin }: { plugin: Plugin }) {
  const { snap, toggle, uninstall, update, busy, groups, setGroups, toast, usage, usageDays } = useHub();
  const [readme, setReadme] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const p = plugin;
  const c = p.components;
  const weight = tokenWeight(alwaysOnTokens(p));
  const diags = p.surface === "cli" ? (snap?.diagnostics.filter((d) => d.pluginId === p.id) ?? []) : [];
  const busyLabel = busy[p.id];
  const groupId = groups.find((g) => g.pluginIds.includes(p.id))?.id ?? "";
  const hasUpdate = p.latestVersion && p.version && p.latestVersion !== p.version;
  const ko = koFor(p);
  const slash = slashItems(p);
  const direct = slash.filter((s) => s.kind === "command" || s.comp.userInvocable);
  const autoOnly = slash.filter((s) => s.kind === "skill" && !s.comp.userInvocable);

  useEffect(() => {
    let alive = true;
    setReadme(null);
    setConfirmRemove(false);
    api.readme(p.id, p.surface).then((r) => alive && setReadme(r)).catch(() => alive && setReadme(null));
    return () => {
      alive = false;
    };
  }, [p.id, p.surface]);

  const moveTo = (gid: string) => {
    const next = groups.map((g) => ({ ...g, pluginIds: g.pluginIds.filter((x) => x !== p.id) }));
    const target = next.find((g) => g.id === gid);
    if (target) target.pluginIds.push(p.id);
    setGroups(next);
  };

  const link = [p.homepage, p.repository].find((u) => u && /^https?:\/\//i.test(u));

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <h2>{p.displayName}</h2>
          <div className="muted mono">{p.id}</div>
        </div>
        <Toggle
          checked={p.enabled && p.installed && !p.folderMissing}
          disabled={!p.toggleable || !p.installed || p.folderMissing || !!snap?.settingsError}
          onChange={(v) => toggle(p, v)}
          label={`${p.displayName} 켜기/끄기`}
        />
      </div>

      {ko && <p className="desc ko">{ko}</p>}
      {p.description && <p className={ko ? "muted small" : "desc"}>{p.description}</p>}

      <div className="meta">
        <span className={`badge ${p.surface}`} title={SURFACE[p.surface].hint}>{SURFACE[p.surface].title} · {SURFACE[p.surface].where}</span>
        {p.version && <span className="badge">v{p.version}</span>}
        {hasUpdate && <span className="badge warn">새 버전 v{p.latestVersion}</span>}
        {p.folderMissing && <span className="badge warn" title={p.projectPath ?? ""}>설치한 폴더 없음</span>}
        {p.scope && <span className="badge">설치 범위: {p.scope === "user" ? "PC 전체" : p.scope === "local" ? "폴더·나만" : "폴더·팀 공유"}</span>}
        {p.author && <span className="badge">제작: {p.author}</span>}
        <span className="badge">슬래시 명령 {direct.length}개</span>
        <span className={`badge cost ${weight.level}`} title={`세션을 시작할 때마다 스킬·명령·에이전트 설명이 컨텍스트에 들어갑니다. 추정값입니다. ${weight.hint}`}>{weight.label} · 매 세션 약 {formatTokens(alwaysOnTokens(p))} 토큰{c.mcpServers.length ? " + MCP" : ""}</span>
        {p.surface === "cli" && usage && (
          <span className={`badge ${usageOf(usage, p)?.count ? "ok" : recentlyInstalled(p) ? "" : "warn"}`}>{usageLabel(usageOf(usage, p), usageDays, p)}</span>
        )}
      </div>

      {!p.toggleable && (
        <p className="note">
          Claude 채팅 플러그인은 계정과 동기화되어 Claude 앱이 관리합니다. 켜고 끄기·삭제는 아래 "Claude 앱에서 이 플러그인 열기"로 앱의 해당 화면을 바로 열어 하면 되고, 바꾼 내용은 이 화면에 바로 반영됩니다.
        </p>
      )}

      <div className="actions">
        {p.surface === "cli" && (
          <select value={groupId} onChange={(e) => moveTo(e.target.value)} aria-label="묶음">
            <option value="">묶음: 미분류</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>묶음: {g.name}</option>
            ))}
          </select>
        )}
        {link && <button onClick={() => openUrl(link).catch((e) => toast("error", errorText(e)))}>웹에서 보기</button>}
        {p.surface === "cli" && p.installed && hasUpdate && !p.folderMissing && (
          <button disabled={!!busyLabel} onClick={() => update(p)}>업데이트</button>
        )}
        {p.surface === "cli" && p.installed && !confirmRemove && (
          <button className="danger" disabled={!!busyLabel} onClick={() => setConfirmRemove(true)}>{p.folderMissing ? "설치 기록 정리" : "삭제"}</button>
        )}
        {confirmRemove && (
          <span className="confirm" role="alertdialog" aria-label="삭제 확인">
            {p.folderMissing
              ? "같은 경로에 빈 폴더를 잠깐 만들어 기록을 지운 뒤 그 폴더도 지웁니다. 진행할까요?"
              : "플러그인 파일과 설치 기록을 지웁니다. 나중에 다시 설치할 수 있습니다. 잠시 안 쓰려는 것이면 끄기만 해도 됩니다."}
            <button className="danger" onClick={() => { setConfirmRemove(false); uninstall(p); }}>{p.folderMissing ? "정리" : "삭제"}</button>
            <button autoFocus onClick={() => setConfirmRemove(false)}>취소</button>
          </span>
        )}
        {busyLabel && <span className="spinner-text">{busyLabel}…</span>}
      </div>

      {p.surface === "cli" && p.installed && (
        <section>
          <h3>적용 범위 · 어느 폴더에서 쓸까요?</h3>
          {p.folderMissing ? (
            <p className="note">
              이 플러그인은 <b>{p.projectPath}</b> 폴더에서만 쓰도록 설치되었는데, 그 폴더가 삭제되어 지금은 어디에서도 동작하지 않습니다.
              Claude Code는 폴더 범위 플러그인을 그 폴더 안에서만 지울 수 있어서, 켜기·끄기와 업데이트가 되지 않습니다.
              위의 "설치 기록 정리"를 누르면 남은 기록을 지웁니다. 다른 곳에서 쓰려면 정리한 뒤 다시 설치하세요.
            </p>
          ) : (
            <ScopeEditor key={p.id} plugin={p} />
          )}
        </section>
      )}

      {diags.length > 0 && (
        <section>
          <h3>감지된 문제</h3>
          {diags.map((d) => <DiagnosticItem key={d.id} d={d} />)}
        </section>
      )}

      {p.surface === "desktop" && (
        <section>
          <h3>Claude 앱에서 쓰는 법</h3>
          <AppUsage key={p.id} plugin={p} />
        </section>
      )}

      {p.surface === "cli" && <section>
        <h3>슬래시 명령</h3>
        <SlashHelp />
        {direct.length === 0 && autoOnly.length === 0 ? (
          <p className="muted">이 플러그인에는 슬래시 명령이 없습니다.{c.mcpServers.length > 0 && " MCP 서버로 도구를 제공하므로, 관련 작업을 요청하면 Claude가 도구를 씁니다."}</p>
        ) : (
          <ul className="cmd-list">
            {direct.map((s) => <SlashRow key={s.kind + s.comp.name} item={s} />)}
          </ul>
        )}
        {autoOnly.length > 0 && (
          <>
            <h4>자동으로만 쓰이는 스킬 {autoOnly.length}개</h4>
            <ul className="cmd-list">{autoOnly.map((s) => <SlashRow key={s.comp.name} item={s} />)}</ul>
          </>
        )}
      </section>}

      {(c.agents.length > 0 || c.hooks.length > 0 || c.mcpServers.length > 0) && (
        <section>
          <h3>그 밖의 구성 요소</h3>
          {c.agents.length > 0 && (
            <div className="usage-block">
              <h4>에이전트 {c.agents.length}개</h4>
              <p className="muted small">Claude가 복잡한 작업을 나눠 맡길 때 쓰는 전문 도우미입니다. "○○ 에이전트로 검토해 줘"처럼 요청할 수 있습니다.</p>
              <ul className="comp-list">
                {c.agents.map((s) => (
                  <li key={s.name}><code>{s.name}</code><span>{s.description}</span></li>
                ))}
              </ul>
            </div>
          )}
          {c.hooks.length > 0 && (
            <div className="usage-block">
              <h4>자동 실행 훅</h4>
              <p className="small">{c.hooks.join(", ")} 시점에 스크립트가 자동으로 실행됩니다. 명령을 입력하지 않아도 동작합니다.</p>
            </div>
          )}
          {c.mcpServers.length > 0 && (
            <div className="usage-block">
              <h4>MCP 서버</h4>
              <p className="small">{c.mcpServers.join(", ")} — 외부 서비스와 연결되는 도구입니다. 처음 쓸 때 해당 서비스 로그인이 필요할 수 있습니다.</p>
            </div>
          )}
        </section>
      )}

      <section>
        <h3>한국어 가이드</h3>
        <GuidePanel key={`${p.surface}:${p.id}`} id={p.id} version={p.version} surface={p.surface} installed={p.pathExists} name={p.displayName} description={p.description} />
      </section>

      <section>
        <details>
          <summary><h3 className="inline">README (원문)</h3></summary>
          {readme ? <Markdown source={readme} /> : <p className="muted">README가 없습니다.</p>}
        </details>
      </section>
    </div>
  );
}
