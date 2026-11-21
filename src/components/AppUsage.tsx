import { useMemo, useState } from "react";
import { api, errorText } from "../api";
import { useHub } from "../hub";
import type { Component, Plugin } from "../types";
import { appPluginRef } from "../claudeApp";
import { koDescription } from "../catalogMeta";
import { CopyButton } from "./CopyButton";

interface Item {
  comp: Component;
  kind: "skill" | "command";
}

function defaultPrompt(p: Plugin, it: Item): string {
  if (it.comp.examples[0]) return it.comp.examples[0];
  return `${p.displayName} 플러그인의 '${it.comp.name}' 기능을 써서 도와줘.\n\n하고 싶은 일: `;
}

export function AppUsage({ plugin }: { plugin: Plugin }) {
  const { toast } = useHub();
  const p = plugin;
  const items: Item[] = useMemo(
    () => [
      ...p.components.skills.filter((c) => c.userInvocable || c.modelInvocable).map((comp) => ({ comp, kind: "skill" as const })),
      ...p.components.commands.map((comp) => ({ comp, kind: "command" as const })),
    ],
    [p],
  );
  const [sel, setSel] = useState(0);
  const current = items[sel] ?? null;
  const [text, setText] = useState(() => (current ? defaultPrompt(p, current) : `${p.displayName} 플러그인으로 도와줘.\n\n하고 싶은 일: `));
  const ref = appPluginRef(p);
  const ko = koDescription(p.id);

  const pick = (i: number) => {
    setSel(i);
    setText(defaultPrompt(p, items[i]));
  };

  const open = async (kind: "plugin" | "plugins" | "chat", value?: string | null) => {
    try {
      await api.openInClaudeApp(kind, value);
      if (kind === "chat") toast("ok", "Claude 앱 새 채팅에 요청을 넣었습니다. 내용을 확인하고 보내세요.");
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  return (
    <div className="app-usage">
      <ol className="steps small">
        <li>
          <strong>켜져 있는지 확인</strong> — 지금 {p.enabled ? <span className="badge ok">켜짐</span> : <span className="badge warn">꺼짐</span>}
          {!p.enabled && " 상태입니다. Claude 앱의 플러그인 화면에서 켜세요."}
          <button className="link" onClick={() => open(ref ? "plugin" : "plugins", ref)}>Claude 앱에서 이 플러그인 열기</button>
        </li>
        <li>
          <strong>새 채팅에서 하고 싶은 일을 말하기</strong> — 아래에서 기능을 고르고 요청을 다듬은 뒤 "새 채팅에 넣기"를 누르면 Claude 앱이 열리고 입력창에 들어갑니다. 보내기는 직접 누릅니다.
        </li>
        <li>
          <strong>Claude가 알맞은 기능을 골라 씀</strong> — 기능 이름을 말하면 더 확실합니다. 파일을 만들거나 고치는 일은 Cowork에서 하면 결과 파일을 바로 받을 수 있습니다.
        </li>
      </ol>

      {ko && <p className="muted small">{ko}</p>}

      {items.length > 0 ? (
        <ul className="usage-items">
          {items.map((it, i) => (
            <li key={it.kind + it.comp.name} className={i === sel ? "selected" : ""}>
              <button className="usage-pick" onClick={() => pick(i)} aria-pressed={i === sel}>
                <code>{it.comp.name}</code>
                <span className="muted small">{it.comp.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">이 플러그인에서 읽을 수 있는 기능 목록이 없습니다. 하고 싶은 일을 그대로 요청하세요.</p>
      )}

      <label className="small" htmlFor="app-prompt"><strong>보낼 요청</strong> (고쳐 써도 됩니다)</label>
      <textarea id="app-prompt" className="prompt-box" rows={4} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} />
      {current && current.comp.examples.length > 1 && (
        <div className="chips small">
          {current.comp.examples.slice(0, 4).map((ex) => (
            <button key={ex} className="chip" onClick={() => setText(ex)}>{ex}</button>
          ))}
        </div>
      )}
      <div className="actions">
        <button className="primary" disabled={!text.trim()} onClick={() => open("chat", text)}>Claude 앱 새 채팅에 넣기</button>
        <CopyButton text={text} />
      </div>
    </div>
  );
}
