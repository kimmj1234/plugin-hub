import { useMemo, useState } from "react";
import { useHub } from "../hub";
import { Toggle } from "../components/Toggle";
import { PluginDetail } from "../components/PluginDetail";
import type { Plugin, Surface } from "../types";

const ALL = "__all";
const UNGROUPED = "__none";

export function Installed() {
  const { snap, groups, setGroups, toggle, toggleMany } = useHub();
  const [surface, setSurface] = useState<Surface>("cli");
  const [folder, setFolder] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const plugins = useMemo(() => snap?.plugins.filter((p) => p.surface === surface) ?? [], [snap, surface]);
  const grouped = new Set(groups.flatMap((g) => g.pluginIds));

  const inFolder = (p: Plugin) =>
    folder === ALL ? true : folder === UNGROUPED ? !grouped.has(p.id) : groups.find((g) => g.id === folder)?.pluginIds.includes(p.id);

  const q = query.trim().toLowerCase();
  const visible = plugins.filter(
    (p) => (surface === "desktop" || inFolder(p)) && (!q || `${p.displayName} ${p.id} ${p.description}`.toLowerCase().includes(q)),
  );
  const current = plugins.find((p) => p.id === selected) ?? null;
  const problemIds = new Set(snap?.diagnostics.filter((d) => d.severity !== "info").map((d) => d.pluginId));

  const addGroup = () => {
    const name = newName.trim();
    if (!name) return;
    const g = { id: `g${Date.now()}`, name, pluginIds: [] };
    setGroups([...groups, g]);
    setNewName("");
    setFolder(g.id);
  };

  const removeGroup = (id: string) => {
    setGroups(groups.filter((g) => g.id !== id));
    if (folder === id) setFolder(ALL);
  };

  const renameGroup = (id: string, name: string) => {
    if (name.trim()) setGroups(groups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)));
    setRenaming(null);
  };

  if (!snap) return null;

  return (
    <div className="split">
      <div className="pane list-pane">
        <div className="tabs">
          <button className={surface === "cli" ? "active" : ""} onClick={() => { setSurface("cli"); setSelected(null); }}>
            터미널·Claude Code <span className="count">{snap.plugins.filter((p) => p.surface === "cli").length}</span>
          </button>
          <button className={surface === "desktop" ? "active" : ""} onClick={() => { setSurface("desktop"); setSelected(null); }}>
            Claude 앱 <span className="count">{snap.plugins.filter((p) => p.surface === "desktop").length}</span>
          </button>
        </div>

        {surface === "cli" && (
          <div className="folders">
            <FolderRow label="전체" active={folder === ALL} count={plugins.length} onClick={() => setFolder(ALL)} />
            {groups.map((g) => {
              const members = plugins.filter((p) => g.pluginIds.includes(p.id));
              return renaming === g.id ? (
                <input
                  key={g.id}
                  autoFocus
                  defaultValue={g.name}
                  onBlur={(e) => renameGroup(g.id, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && renameGroup(g.id, (e.target as HTMLInputElement).value)}
                />
              ) : (
                <FolderRow
                  key={g.id}
                  label={`📁 ${g.name}`}
                  active={folder === g.id}
                  count={members.length}
                  onClick={() => setFolder(g.id)}
                  extra={
                    folder === g.id && (
                      <span className="folder-actions">
                        <button title="폴더 안 플러그인 모두 켜기" onClick={(e) => { e.stopPropagation(); toggleMany(members, true); }}>모두 켬</button>
                        <button title="폴더 안 플러그인 모두 끄기" onClick={(e) => { e.stopPropagation(); toggleMany(members, false); }}>모두 끔</button>
                        <button title="이름 바꾸기" onClick={(e) => { e.stopPropagation(); setRenaming(g.id); }}>✎</button>
                        <button title="폴더 삭제 (플러그인은 그대로)" onClick={(e) => { e.stopPropagation(); removeGroup(g.id); }}>✕</button>
                      </span>
                    )
                  }
                />
              );
            })}
            <FolderRow label="미분류" active={folder === UNGROUPED} count={plugins.filter((p) => !grouped.has(p.id)).length} onClick={() => setFolder(UNGROUPED)} />
            <div className="new-folder">
              <input placeholder="새 폴더 이름" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGroup()} />
              <button onClick={addGroup} disabled={!newName.trim()}>추가</button>
            </div>
          </div>
        )}

        <input className="search" placeholder="설치된 플러그인 검색" value={query} onChange={(e) => setQuery(e.target.value)} />

        <ul className="plugin-list">
          {visible.map((p) => (
            <li key={p.id} className={p.id === selected ? "selected" : ""} onClick={() => setSelected(p.id)}>
              <div className="pl-main">
                <div className="pl-name">
                  {problemIds.has(p.id) && <span className="dot bad" title="문제 감지됨" />}
                  {p.displayName}
                </div>
                <div className="pl-sub">
                  {p.marketplace || "출처 미상"}
                  {p.version && ` · v${p.version}`}
                  {!p.installed && " · 미설치"}
                </div>
              </div>
              <Toggle
                checked={p.enabled}
                disabled={!p.toggleable || !p.installed || !!snap.settingsError}
                onChange={(v) => toggle(p, v)}
                label={`${p.displayName} 켜기/끄기`}
              />
            </li>
          ))}
          {visible.length === 0 && (
            <li className="empty">
              {plugins.length === 0
                ? surface === "cli"
                  ? "설치된 플러그인이 없습니다. '플러그인 찾기'에서 설치해 보세요."
                  : "Claude 앱에 동기화된 플러그인이 없습니다."
                : "조건에 맞는 플러그인이 없습니다."}
            </li>
          )}
        </ul>
      </div>
      <div className="pane detail-pane">
        {current ? <PluginDetail plugin={current} /> : <div className="empty-detail">왼쪽에서 플러그인을 고르면 용도와 사용 방법을 보여줍니다.</div>}
      </div>
    </div>
  );
}

function FolderRow({ label, active, count, onClick, extra }: { label: string; active: boolean; count: number; onClick: () => void; extra?: React.ReactNode }) {
  return (
    <div className={`folder ${active ? "active" : ""}`} onClick={onClick}>
      <span className="folder-label">{label}</span>
      {extra}
      <span className="count">{count}</span>
    </div>
  );
}
