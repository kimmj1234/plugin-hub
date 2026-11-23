import { Installed } from "./Installed";
import { Scopes } from "./Scopes";
import { Commands } from "./Commands";

export type PluginsTab = "list" | "folders" | "commands";

const TABS: { key: PluginsTab; label: string; hint: string }[] = [
  { key: "list", label: "목록", hint: "켜고 끄기 · 정리 · 사용법" },
  { key: "folders", label: "폴더별 적용", hint: "작업 폴더마다 켜고 끄기" },
  { key: "commands", label: "명령어 모음", hint: "쓸 수 있는 / 명령 한눈에" },
];

export function MyPlugins({ tab, setTab, focus }: { tab: PluginsTab; setTab: (t: PluginsTab) => void; focus?: string | null }) {
  return (
    <div className="stack">
      <div className="subnav" role="tablist" aria-label="내 플러그인">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)} title={t.hint}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="stack-body">
        {tab === "list" && <Installed key={focus ?? ""} focus={focus} />}
        {tab === "folders" && <Scopes />}
        {tab === "commands" && <Commands />}
      </div>
    </div>
  );
}
