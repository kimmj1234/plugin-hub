import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { useHub } from "../hub";
import type { Plugin } from "../types";
import { Markdown } from "./Markdown";
import { Toggle } from "./Toggle";
import { DiagnosticItem } from "./DiagnosticItem";

export function PluginDetail({ plugin }: { plugin: Plugin }) {
  const { snap, toggle, uninstall, update, busy, groups, setGroups } = useHub();
  const [readme, setReadme] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const p = plugin;
  const c = p.components;
  const diags = snap?.diagnostics.filter((d) => d.pluginId === p.id) ?? [];
  const busyLabel = busy[p.id];
  const groupId = groups.find((g) => g.pluginIds.includes(p.id))?.id ?? "";
  const hasUpdate = p.latestVersion && p.version && p.latestVersion !== p.version;

  useEffect(() => {
    setReadme(null);
    setConfirmRemove(false);
    api.readme(p.id, p.surface).then(setReadme).catch(() => setReadme(null));
  }, [p.id, p.surface]);

  const moveTo = (gid: string) => {
    const next = groups.map((g) => ({ ...g, pluginIds: g.pluginIds.filter((x) => x !== p.id) }));
    const target = next.find((g) => g.id === gid);
    if (target) target.pluginIds.push(p.id);
    setGroups(next);
  };

  const link = p.homepage || p.repository;

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <h2>{p.displayName}</h2>
          <div className="muted mono">{p.id}</div>
        </div>
        <Toggle
          checked={p.enabled}
          disabled={!p.toggleable || !p.installed || !!snap?.settingsError}
          onChange={(v) => toggle(p, v)}
          label={`${p.displayName} 켜기/끄기`}
        />
      </div>

      {p.description && <p className="desc">{p.description}</p>}

      <div className="meta">
        <span className={`badge ${p.surface}`}>{p.surface === "cli" ? "터미널·Claude Code" : "Claude 앱"}</span>
        {p.version && <span className="badge">v{p.version}</span>}
        {hasUpdate && <span className="badge warn">새 버전 v{p.latestVersion}</span>}
        {p.scope && <span className="badge">범위: {p.scope}</span>}
        {p.author && <span className="badge">제작: {p.author}</span>}
      </div>

      {!p.toggleable && (
        <p className="note">
          Claude 앱 플러그인은 앱이 계정과 동기화해 관리합니다. 여기서 바꿔도 앱이 되돌릴 수 있어 읽기 전용으로 보여줍니다. 켜고 끄기는 Claude 앱의 설정에서 하세요.
        </p>
      )}

      <div className="actions">
        {p.surface === "cli" && (
          <select value={groupId} onChange={(e) => moveTo(e.target.value)} aria-label="폴더">
            <option value="">폴더: 미분류</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>폴더: {g.name}</option>
            ))}
          </select>
        )}
        {link && <button onClick={() => openUrl(link)}>웹에서 보기</button>}
        {p.surface === "cli" && p.installed && hasUpdate && (
          <button disabled={!!busyLabel} onClick={() => update(p)}>업데이트</button>
        )}
        {p.surface === "cli" && p.installed && !confirmRemove && (
          <button className="danger" disabled={!!busyLabel} onClick={() => setConfirmRemove(true)}>삭제</button>
        )}
        {confirmRemove && (
          <span className="confirm">
            정말 삭제할까요?
            <button className="danger" onClick={() => { setConfirmRemove(false); uninstall(p); }}>삭제</button>
            <button onClick={() => setConfirmRemove(false)}>취소</button>
          </span>
        )}
        {busyLabel && <span className="spinner-text">{busyLabel}…</span>}
      </div>

      {diags.length > 0 && (
        <section>
          <h3>감지된 문제</h3>
          {diags.map((d) => <DiagnosticItem key={d.id} d={d} />)}
        </section>
      )}

      <section>
        <h3>사용 방법</h3>
        {c.skills.length + c.commands.length + c.agents.length === 0 && c.hooks.length === 0 && c.mcpServers.length === 0 ? (
          <p className="muted">구성 요소 정보를 찾지 못했습니다. 아래 README를 참고하세요.</p>
        ) : (
          <>
            {c.skills.length > 0 && (
              <div className="usage-block">
                <h4>스킬 {c.skills.length}개</h4>
                <p className="muted small">
                  설명에 맞는 요청을 하면 Claude가 자동으로 고릅니다. 직접 부르려면 <code>/{p.name}:스킬이름</code>을 입력하세요.
                </p>
                <ul className="comp-list">
                  {c.skills.map((s) => (
                    <li key={s.name}>
                      <code>/{p.name}:{s.name}</code>
                      <span>{s.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.commands.length > 0 && (
              <div className="usage-block">
                <h4>명령어 {c.commands.length}개</h4>
                <ul className="comp-list">
                  {c.commands.map((s) => (
                    <li key={s.name}>
                      <code>/{p.name}:{s.name}</code>
                      <span>{s.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.agents.length > 0 && (
              <div className="usage-block">
                <h4>에이전트 {c.agents.length}개</h4>
                <ul className="comp-list">
                  {c.agents.map((s) => (
                    <li key={s.name}>
                      <code>{s.name}</code>
                      <span>{s.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.hooks.length > 0 && (
              <div className="usage-block">
                <h4>자동 실행 훅</h4>
                <p className="small">{c.hooks.join(", ")} 시점에 스크립트가 자동으로 실행됩니다.</p>
              </div>
            )}
            {c.mcpServers.length > 0 && (
              <div className="usage-block">
                <h4>MCP 서버</h4>
                <p className="small">{c.mcpServers.join(", ")}</p>
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <h3>README</h3>
        {readme ? <Markdown source={readme} /> : <p className="muted">README가 없습니다.</p>}
      </section>
    </div>
  );
}
