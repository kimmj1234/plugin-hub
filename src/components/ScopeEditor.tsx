import { useState } from "react";
import { useHub } from "../hub";
import { api } from "../api";
import type { Plugin, ProjectState } from "../types";
import { SOURCE_LABEL, effective, fromTri, toTri, userEnabledMap, type TriValue } from "../scope";
import { Toggle } from "./Toggle";

export function TriSelect({ value, onChange, label }: { value: TriValue; onChange: (v: TriValue) => void; label: string }) {
  return (
    <select className={`tri ${value}`} value={value} aria-label={label} onChange={(e) => onChange(e.target.value as TriValue)}>
      <option value="inherit">기본값 따름</option>
      <option value="on">켬</option>
      <option value="off">끔</option>
    </select>
  );
}

export function EffectiveBadge({ on, source }: { on: boolean; source: keyof typeof SOURCE_LABEL }) {
  return (
    <span className={`badge ${on ? "ok" : ""}`} title={`${SOURCE_LABEL[source]}에 따라 결정됨`}>
      {on ? "켜짐" : "꺼짐"} · {SOURCE_LABEL[source]}
    </span>
  );
}

export function ScopeEditor({ plugin }: { plugin: Plugin }) {
  const { snap, toggle, setFolder, addProject } = useHub();
  const [openState, setOpenState] = useState<boolean | null>(null);
  if (!snap || plugin.surface !== "cli") return null;
  const p = plugin;
  const userMap = userEnabledMap(snap.plugins);
  const folderInstalled = p.scope === "project" || p.scope === "local";
  const projects: ProjectState[] = snap.projects;
  // 폴더마다 따로 정한 값이 있으면 처음부터 펼쳐 둔다. 없으면 접어 두고 필요할 때만 연다.
  const overridden = projects.filter((pr) => pr.shared[p.id] !== undefined || pr.local[p.id] !== undefined);
  const open = openState ?? overridden.length > 0;

  const add = async () => {
    const path = await api.pickFolder();
    if (path) await addProject(path);
  };

  return (
    <div className="scope-editor">
      {folderInstalled ? (
        <p className="note small">
          이 플러그인은 <strong>{p.projectPath}</strong> 폴더에만 {p.scope === "local" ? "나만 쓰도록(개인)" : "팀 공유로"} 설치되어 있습니다. 다른 폴더에서는 쓰이지 않습니다.
        </p>
      ) : (
        <div className="scope-row head">
          <div>
            <strong>PC 전체 기본값</strong>
            <div className="muted small">모든 폴더에 적용됩니다. 폴더에서 따로 정하면 그 폴더 설정이 우선합니다.</div>
          </div>
          <Toggle checked={p.enabled} disabled={!p.installed || !!snap.settingsError} onChange={(v) => toggle(p, v)} label="PC 전체 기본값 켜기/끄기" />
        </div>
      )}

      {!folderInstalled && !open && (
        <div className="scope-summary">
          <span className="muted small">
            {overridden.length === 0 ? "모든 작업 폴더에서 위 기본값을 따릅니다." : `작업 폴더 ${overridden.length}곳에서 따로 정했습니다.`}
          </span>
          <button onClick={() => setOpenState(true)} aria-expanded={false}>폴더별로 따로 정하기</button>
        </div>
      )}

      {!folderInstalled && open && (
        <>
          <table className="scope-table">
            <thead>
              <tr>
                <th>폴더</th>
                <th title=".claude/settings.json — git으로 팀과 공유됩니다">팀 공유</th>
                <th title=".claude/settings.local.json — 이 PC의 나에게만 적용됩니다">나만</th>
                <th>실제 적용</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((pr) => {
                const eff = effective(p, pr, userMap);
                return (
                  <tr key={pr.path} className={pr.exists ? "" : "missing"}>
                    <td title={pr.path}>
                      📁 {pr.name}
                      {!pr.exists && <span className="badge warn">폴더 없음</span>}
                    </td>
                    <td>
                      <TriSelect label={`${pr.name} 팀 공유`} value={toTri(pr.shared[p.id])} onChange={(v) => setFolder(p.id, pr.path, "project", fromTri(v))} />
                    </td>
                    <td>
                      <TriSelect label={`${pr.name} 나만`} value={toTri(pr.local[p.id])} onChange={(v) => setFolder(p.id, pr.path, "local", fromTri(v))} />
                    </td>
                    <td><EffectiveBadge {...eff} /></td>
                  </tr>
                );
              })}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted small">등록한 폴더가 없습니다. 특정 프로젝트에서만 켜거나 끄려면 폴더를 추가하세요.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="actions">
            <button onClick={add}>+ 폴더 추가</button>
            {overridden.length === 0 && <button onClick={() => setOpenState(false)} aria-expanded={true}>접기</button>}
            <span className="muted small">"팀 공유"는 폴더의 <code>.claude/settings.json</code>에 저장되어 git으로 팀원에게도 적용됩니다.</span>
          </div>
        </>
      )}
    </div>
  );
}
