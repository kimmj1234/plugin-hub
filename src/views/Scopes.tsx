import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useHub } from "../hub";
import type { ProjectFolder } from "../types";
import { effective, fromTri, toTri, userEnabledMap } from "../scope";
import { EffectiveBadge, TriSelect } from "../components/ScopeEditor";
import { Toggle } from "../components/Toggle";

const PC = "__pc";

export function Scopes() {
  const { snap, projects, addProject, removeProject, setFolder, toggle, toggleMany } = useHub();
  const [selected, setSelected] = useState<string>(PC);
  const [suggest, setSuggest] = useState<ProjectFolder[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.suggestProjects().then(setSuggest).catch(() => {});
  }, [projects.length]);

  const plugins = useMemo(
    () => (snap?.plugins ?? []).filter((p) => p.surface === "cli" && p.installed && (p.scope ?? "user") === "user"),
    [snap],
  );
  const folderOnly = (snap?.plugins ?? []).filter((p) => p.surface === "cli" && (p.scope === "project" || p.scope === "local"));
  if (!snap) return null;
  const userMap = userEnabledMap(snap.plugins);
  const pr = snap.projects.find((x) => x.path === selected) ?? null;
  const registered = new Set(projects.map((p) => p.path));
  const suggestions = suggest.filter((s) => !registered.has(s.path));
  const q = query.trim().toLowerCase();
  const shown = plugins.filter((p) => !q || `${p.displayName} ${p.id}`.toLowerCase().includes(q));

  const add = async () => {
    const path = await api.pickFolder();
    if (path) {
      await addProject(path);
      setSelected(path);
    }
  };

  const setAll = (scope: "project" | "local", value: boolean | null) => {
    if (!pr) return;
    shown.forEach((p) => setFolder(p.id, pr.path, scope, value));
  };

  return (
    <div className="split">
      <div className="pane list-pane">
        <h3 className="pane-title">적용 범위</h3>
        <p className="muted small">플러그인을 PC 전체에 쓸지, 특정 작업 폴더에서만 쓸지 정합니다.</p>
        <div className={`folder ${selected === PC ? "active" : ""}`} onClick={() => setSelected(PC)}>
          <span className="folder-label">🖥️ PC 전체 기본값</span>
          <span className="count">{plugins.filter((p) => p.enabled).length}/{plugins.length}</span>
        </div>
        <div className="folders">
          {snap.projects.map((x) => {
            const overrides = Object.keys(x.shared).length + Object.keys(x.local).length;
            return (
              <div key={x.path} className={`folder ${selected === x.path ? "active" : ""}`} onClick={() => setSelected(x.path)} title={x.path}>
                <span className="folder-label">📁 {x.name}{!x.exists && " ⚠️"}</span>
                {overrides > 0 && <span className="count" title="이 폴더에서 따로 정한 플러그인 수">{overrides}</span>}
              </div>
            );
          })}
        </div>
        <button onClick={add}>+ 작업 폴더 추가</button>
        {suggestions.length > 0 && (
          <div className="suggest">
            <div className="muted small">Claude Code로 작업했던 폴더</div>
            {suggestions.slice(0, 12).map((s) => (
              <div key={s.path} className="suggest-row" title={s.path}>
                <span className="folder-label">{s.name}</span>
                <button onClick={() => addProject(s.path).then(() => setSelected(s.path))}>추가</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pane detail-pane">
        <div className="detail">
          <div className="note">
            <strong>어디에 적용되나요?</strong>
            <ul className="small">
              <li><strong>PC 전체 기본값</strong> (<code>~/.claude/settings.json</code>): 이 PC의 모든 폴더에서 적용됩니다.</li>
              <li><strong>폴더 · 팀 공유</strong> (<code>폴더/.claude/settings.json</code>): 그 폴더에서만 적용되고, git에 올리면 팀원에게도 적용됩니다.</li>
              <li><strong>폴더 · 나만</strong> (<code>폴더/.claude/settings.local.json</code>): 그 폴더에서 나에게만 적용됩니다.</li>
              <li>우선순위: 나만 &gt; 팀 공유 &gt; PC 전체. "기본값 따름"은 그 폴더 설정을 지우고 위 단계를 따릅니다.</li>
            </ul>
          </div>

          {selected === PC ? (
            <>
              <h2>
                PC 전체 기본값
                <span className="folder-actions">
                  <button onClick={() => toggleMany(plugins, true)}>모두 켬</button>
                  <button onClick={() => toggleMany(plugins, false)}>모두 끔</button>
                </span>
              </h2>
              <ul className="plugin-list">
                {plugins.map((p) => (
                  <li key={p.id}>
                    <div className="pl-main">
                      <div className="pl-name">{p.displayName}</div>
                      <div className="pl-sub">{p.id}</div>
                    </div>
                    <Toggle checked={p.enabled} disabled={!!snap.settingsError} onChange={(v) => toggle(p, v)} label={`${p.displayName} PC 전체 기본값`} />
                  </li>
                ))}
                {plugins.length === 0 && <li className="empty">PC 전체 범위로 설치된 플러그인이 없습니다.</li>}
              </ul>
            </>
          ) : pr ? (
            <>
              <h2>
                📁 {pr.name}
                <button className="link danger" onClick={() => { removeProject(pr.path); setSelected(PC); }}>목록에서 빼기</button>
              </h2>
              <div className="muted mono small">{pr.path}</div>
              <div className="meta">
                {pr.isGitRepo ? <span className="badge">git 저장소 · 팀 공유 설정은 커밋하면 팀원에게 적용</span> : <span className="badge">git 저장소 아님</span>}
                {!pr.exists && <span className="badge warn">폴더를 찾을 수 없음</span>}
              </div>
              {(pr.sharedError || pr.localError) && <div className="note bad small">{pr.sharedError || pr.localError}</div>}

              <div className="toolbar">
                <input className="search" placeholder="플러그인 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
                <select onChange={(e) => { const [sc, v] = e.target.value.split(":"); if (sc) setAll(sc as "project" | "local", v === "inherit" ? null : v === "on"); e.target.value = ""; }} defaultValue="" aria-label="한 번에 바꾸기">
                  <option value="" disabled>한 번에 바꾸기…</option>
                  <option value="local:on">보이는 것 모두 켬 (나만)</option>
                  <option value="local:off">보이는 것 모두 끔 (나만)</option>
                  <option value="local:inherit">나만 설정 모두 지우기</option>
                  <option value="project:inherit">팀 공유 설정 모두 지우기</option>
                </select>
              </div>

              <table className="scope-table wide">
                <thead>
                  <tr>
                    <th>플러그인</th>
                    <th>PC 기본값</th>
                    <th>팀 공유</th>
                    <th>나만</th>
                    <th>이 폴더에서 실제 적용</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => {
                    const eff = effective(p, pr, userMap);
                    return (
                      <tr key={p.id}>
                        <td title={p.id}><strong>{p.displayName}</strong></td>
                        <td><span className={`badge ${p.enabled ? "ok" : ""}`}>{p.enabled ? "켜짐" : "꺼짐"}</span></td>
                        <td><TriSelect label={`${p.displayName} 팀 공유`} value={toTri(pr.shared[p.id])} onChange={(v) => setFolder(p.id, pr.path, "project", fromTri(v))} /></td>
                        <td><TriSelect label={`${p.displayName} 나만`} value={toTri(pr.local[p.id])} onChange={(v) => setFolder(p.id, pr.path, "local", fromTri(v))} /></td>
                        <td><EffectiveBadge {...eff} /></td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={5} className="muted small">PC 전체 범위로 설치된 플러그인이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
              {folderOnly.filter((p) => p.projectPath === pr.path).length > 0 && (
                <>
                  <h3>이 폴더에만 설치된 플러그인</h3>
                  <ul className="plugin-list">
                    {folderOnly.filter((p) => p.projectPath === pr.path).map((p) => (
                      <li key={p.id}>
                        <div className="pl-main">
                          <div className="pl-name">{p.displayName}</div>
                          <div className="pl-sub">{p.scope === "local" ? "나만" : "팀 공유"} 범위 설치</div>
                        </div>
                        <Toggle checked={p.enabled} onChange={(v) => toggle(p, v)} label={`${p.displayName} 켜기/끄기`} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
