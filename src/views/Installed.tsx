import { useEffect, useMemo, useRef, useState } from "react";
import { selectable } from "../a11y";
import { useHub } from "../hub";
import { Toggle } from "../components/Toggle";
import { PluginDetail } from "../components/PluginDetail";
import type { Plugin, Surface } from "../types";
import { koFor } from "../catalogMeta";
import { alwaysOnTokens, formatTokens, recentlyInstalled, tokenWeight, usageLabel, usageOf } from "../cost";
import { SurfaceLabel } from "../surface";

const ALL = "__all";
type SortKey = "name" | "heavy" | "recent" | "unused";
type StateFilter = "all" | "on" | "off" | "problem" | "update";
const SORTS: [SortKey, string][] = [["name", "이름순"], ["heavy", "토큰 많은 순"], ["recent", "최근 설치 순"], ["unused", "적게 쓴 순"]];
const FILTERS: [StateFilter, string][] = [["all", "전체"], ["on", "켜짐"], ["off", "꺼짐"], ["problem", "문제 있음"], ["update", "새 버전"]];

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 저장 못 해도 이번 화면에서는 그대로 쓴다 */
  }
}
const UNGROUPED = "__none";

export function Installed({ focus }: { focus?: string | null } = {}) {
  const { snap, groups, setGroups, toggle, toggleMany, usage, usageDays } = useHub();
  const [surface, setSurface] = useState<Surface>("cli");
  const [folder, setFolder] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameCancelled = useRef(false);
  const [sort, setSortState] = useState<SortKey>(() => stored("installed.sort", SORTS.map((x) => x[0]), "name"));
  const [stateFilter, setStateFilterState] = useState<StateFilter>(() => stored("installed.filter", FILTERS.map((x) => x[0]), "all"));
  const setSort = (v: SortKey) => { setSortState(v); remember("installed.sort", v); };
  const setStateFilter = (v: StateFilter) => { setStateFilterState(v); remember("installed.filter", v); };
  const selectedRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (focus) selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const plugins = useMemo(() => snap?.plugins.filter((p) => p.surface === surface) ?? [], [snap, surface]);
  const grouped = new Set(groups.flatMap((g) => g.pluginIds));

  const inFolder = (p: Plugin) =>
    folder === ALL ? true : folder === UNGROUPED ? !grouped.has(p.id) : groups.find((g) => g.id === folder)?.pluginIds.includes(p.id);

  const installingIds = new Set(snap?.diagnostics.filter((d) => d.id.startsWith("installing:")).map((d) => d.pluginId));
  const problemIds = new Set(snap?.diagnostics.filter((d) => d.severity !== "info" && surface === "cli").map((d) => d.pluginId));
  const q = query.trim().toLowerCase();
  const hasUpdate = (p: Plugin) => !!(p.latestVersion && p.version && p.latestVersion !== p.version);
  const isOn = (p: Plugin) => p.enabled && p.installed && !p.folderMissing;
  const passState = (p: Plugin) =>
    stateFilter === "all" ||
    (stateFilter === "on" && isOn(p)) ||
    (stateFilter === "off" && !isOn(p)) ||
    (stateFilter === "problem" && problemIds.has(p.id)) ||
    (stateFilter === "update" && hasUpdate(p));
  const uses = (p: Plugin) => usageOf(usage, p)?.count ?? 0;
  const visible = plugins
    .filter((p) => (surface === "desktop" || inFolder(p)) && passState(p) && (!q || `${p.displayName} ${p.id} ${p.description}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === "heavy") return alwaysOnTokens(b) - alwaysOnTokens(a);
      if (sort === "recent") return (b.installedAt ?? "").localeCompare(a.installedAt ?? "");
      if (sort === "unused") return uses(a) - uses(b) || alwaysOnTokens(b) - alwaysOnTokens(a);
      return a.displayName.localeCompare(b.displayName);
    });
  const current = plugins.find((p) => p.id === selected) ?? null;

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
    // Esc로 취소했으면 저장하지 않는다. Enter는 입력칸을 벗어나게만 해서 저장이 한 번만 일어나게 한다.
    if (renameCancelled.current) {
      renameCancelled.current = false;
      setRenaming(null);
      return;
    }
    if (name.trim()) setGroups(groups.map((g) => (g.id === id ? { ...g, name: name.trim() } : g)));
    setRenaming(null);
  };

  if (!snap) return null;

  return (
    <div className="split">
      <div className="pane list-pane">
        <div className="tabs">
          <button className={surface === "cli" ? "active" : ""} onClick={() => { setSurface("cli"); setSelected(null); }}>
            <SurfaceLabel s="cli" count={snap.plugins.filter((p) => p.surface === "cli").length} />
          </button>
          <button className={surface === "desktop" ? "active" : ""} onClick={() => { setSurface("desktop"); setSelected(null); }}>
            <SurfaceLabel s="desktop" count={snap.plugins.filter((p) => p.surface === "desktop").length} />
          </button>
        </div>

        {surface === "cli" && (
          <div className="folders" role="group" aria-label="내가 만든 묶음">
            <FolderRow label="전체" active={folder === ALL} count={plugins.length} onClick={() => setFolder(ALL)} />
            {groups.map((g) => {
              const members = plugins.filter((p) => g.pluginIds.includes(p.id));
              return renaming === g.id ? (
                <input
                  key={g.id}
                  autoFocus
                  defaultValue={g.name}
                  onBlur={(e) => renameGroup(g.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      renameCancelled.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <FolderRow
                  key={g.id}
                  label={g.name}
                  active={folder === g.id}
                  count={members.length}
                  onClick={() => setFolder(g.id)}
                  extra={
                    folder === g.id && (
                      <span className="folder-actions">
                        <button title="이 묶음의 플러그인 모두 켜기" onClick={(e) => { e.stopPropagation(); toggleMany(members, true); }}>모두 켬</button>
                        <button title="이 묶음의 플러그인 모두 끄기" onClick={(e) => { e.stopPropagation(); toggleMany(members, false); }}>모두 끔</button>
                        <button title="묶음 이름 바꾸기" onClick={(e) => { e.stopPropagation(); setRenaming(g.id); }}>✎</button>
                        <button title="묶음 삭제 (플러그인은 그대로)" onClick={(e) => { e.stopPropagation(); removeGroup(g.id); }}>✕</button>
                      </span>
                    )
                  }
                />
              );
            })}
            <FolderRow label="미분류" active={folder === UNGROUPED} count={plugins.filter((p) => !grouped.has(p.id)).length} onClick={() => setFolder(UNGROUPED)} />
            <div className="new-folder">
              <input placeholder="새 묶음 이름" aria-label="새 묶음 이름" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addGroup()} />
              <button onClick={addGroup} disabled={!newName.trim()}>추가</button>
            </div>
          </div>
        )}

        <input className="search" placeholder="설치된 플러그인 검색" aria-label="설치된 플러그인 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="list-tools">
          <div className="chips" role="group" aria-label="상태로 거르기">
            {FILTERS.filter(([k]) => surface === "cli" || k === "all" || k === "on" || k === "off").map(([k, label]) => (
              <button key={k} className={`chip ${stateFilter === k ? "active" : ""}`} aria-pressed={stateFilter === k} onClick={() => setStateFilter(k)}>{label}</button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬">
            {SORTS.filter(([k]) => k !== "unused" || (surface === "cli" && usage)).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </div>

        <ul className="plugin-list">
          {visible.map((p) => (
            <li key={p.id} ref={p.id === selected ? selectedRef : undefined} className={p.id === selected ? "selected" : ""} {...selectable(() => setSelected(p.id), p.id === selected)}>
              <div className="pl-main">
                <div className="pl-name">
                  {problemIds.has(p.id) && <span className="dot bad" title="문제 감지됨" />}
                  {p.displayName}
                </div>
                {(koFor(p) || p.description) && <div className="pl-desc">{koFor(p) || p.description}</div>}
                <div className="pl-sub">
                  {!p.installed ? (
                    installingIds.has(p.id) ? <span className="spinner-text">설치 마무리 중…</span> : <span className="bad-text">설치되지 않음</span>
                  ) : (
                    p.folderMissing ? <span className="warn-text" title={p.projectPath ?? ""}>설치한 폴더가 삭제됨 · 기록 정리 필요</span> : <>
                      <TokenWeight n={alwaysOnTokens(p)} />
                      {!!p.otherInstalls?.length && <span title="다른 범위에도 설치되어 있습니다"> · 범위 {p.otherInstalls.length + 1}곳</span>}
                      {surface === "cli" && usage && (
                        <span className={p.enabled && !usageOf(usage, p)?.count && !recentlyInstalled(p) ? "warn-text" : ""}> · {usageLabel(usageOf(usage, p), usageDays, p)}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <Toggle
                checked={p.enabled && p.installed && !p.folderMissing}
                disabled={!p.toggleable || !p.installed || p.folderMissing || !!snap.settingsError}
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

function TokenWeight({ n }: { n: number }) {
  const w = tokenWeight(n);
  return (
    <span title={`매 세션 컨텍스트에 들어가는 양(추정) · ${w.hint}`}>
      <span className={`weight ${w.level}`}>{w.label}</span> ~{formatTokens(n)} 토큰
    </span>
  );
}

function FolderRow({ label, active, count, onClick, extra }: { label: string; active: boolean; count: number; onClick: () => void; extra?: React.ReactNode }) {
  return (
    <div className={`folder ${active ? "active" : ""}`} {...selectable(onClick, active)}>
      <span className="folder-label">{label}</span>
      {extra}
      <span className="count">{count}</span>
    </div>
  );
}
