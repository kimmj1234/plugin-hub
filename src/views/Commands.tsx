import { useMemo, useState } from "react";
import { useHub } from "../hub";
import { SlashHelp, SlashRow, slashItems } from "../components/SlashCommands";
import type { Surface } from "../types";

export function Commands() {
  const { snap } = useHub();
  const [query, setQuery] = useState("");
  const [surface, setSurface] = useState<Surface>("cli");
  const [onlyEnabled, setOnlyEnabled] = useState(true);

  const items = useMemo(
    () =>
      (snap?.plugins ?? [])
        .filter((p) => p.surface === surface && p.installed && (!onlyEnabled || p.enabled))
        .flatMap(slashItems)
        .filter((s) => s.kind === "command" || s.comp.userInvocable),
    [snap, surface, onlyEnabled],
  );
  const q = query.trim().toLowerCase();
  const shown = items.filter((s) => !q || `${s.call} ${s.comp.description} ${s.comp.examples.join(" ")}`.toLowerCase().includes(q));

  if (!snap) return null;
  return (
    <div className="page">
      <h1>슬래시 명령</h1>
      <p className="muted">
        설치된 플러그인이 제공하는 <code>/</code> 명령을 모두 모았습니다. 복사해서 Claude Code 입력창에 붙여 넣으면 됩니다.
      </p>
      <SlashHelp />
      <div className="toolbar">
        <input className="search" placeholder="명령이나 하고 싶은 일로 검색 (예: commit, 배포, review)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="seg">
          <button className={surface === "cli" ? "active" : ""} onClick={() => setSurface("cli")}>터미널·Claude Code</button>
          <button className={surface === "desktop" ? "active" : ""} onClick={() => setSurface("desktop")}>Claude 앱</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} /> 켜진 것만
        </label>
      </div>
      <div className="muted small status-line">{shown.length}개</div>
      {shown.length === 0 ? (
        <div className="empty">
          {items.length === 0 ? "켜진 플러그인 중 슬래시 명령을 제공하는 것이 없습니다." : "검색 결과가 없습니다."}
        </div>
      ) : (
        <ul className="cmd-list">{shown.map((s) => <SlashRow key={s.plugin.id + s.kind + s.comp.name} item={s} showPlugin />)}</ul>
      )}
    </div>
  );
}
