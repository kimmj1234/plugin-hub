import type { Component, Plugin } from "../types";
import { CopyButton } from "./CopyButton";

export interface SlashItem {
  plugin: Plugin;
  comp: Component;
  kind: "command" | "skill";
  /** 입력하는 이름: /플러그인:이름 */
  call: string;
}

/** 플러그인의 명령어와 스킬을 슬래시 명령 목록으로 */
export function slashItems(p: Plugin): SlashItem[] {
  const ns = p.displayName || p.name;
  const items: SlashItem[] = [];
  for (const c of p.components.commands) items.push({ plugin: p, comp: c, kind: "command", call: `/${ns}:${c.name}` });
  for (const c of p.components.skills) items.push({ plugin: p, comp: c, kind: "skill", call: `/${ns}:${c.name}` });
  return items;
}

export function InvokeBadges({ c, kind }: { c: Component; kind: "command" | "skill" }) {
  if (kind === "command") return <span className="badge">명령어 · 직접 입력</span>;
  if (!c.userInvocable) return <span className="badge">자동 전용 · / 메뉴에 없음</span>;
  if (!c.modelInvocable) return <span className="badge warn">직접 입력 전용</span>;
  return <span className="badge ok">직접 입력 + 자동 호출</span>;
}

export function SlashRow({ item, showPlugin }: { item: SlashItem; showPlugin?: boolean }) {
  const { comp: c, kind, call } = item;
  const full = c.argumentHint ? `${call} ${c.argumentHint}` : call;
  return (
    <li className="cmd">
      <div className="cmd-line">
        <code className="cmd-name">
          {call}
          {c.argumentHint && <span className="arg"> {c.argumentHint}</span>}
        </code>
        {(kind === "command" || c.userInvocable) && <CopyButton text={call} />}
        <InvokeBadges c={c} kind={kind} />
        {showPlugin && <span className="muted small">{item.plugin.displayName}{!item.plugin.enabled && " (꺼짐)"}</span>}
      </div>
      {c.description && <div className="cmd-desc">{c.description}</div>}
      {c.argumentHint && (
        <div className="muted small">
          입력 형식: <code>{full}</code> — <code>&lt;…&gt;</code>는 꼭 넣는 값, <code>[…]</code>는 생략 가능한 값입니다.
        </div>
      )}
      {c.examples.length > 0 && (
        <div className="example">
          이렇게 말해도 됩니다: {c.examples.slice(0, 4).map((e, i) => <q key={i}>{e}</q>)}
        </div>
      )}
    </li>
  );
}

export function SlashHelp() {
  return (
    <details className="slash-help">
      <summary>슬래시 명령은 어떻게 쓰나요?</summary>
      <ul className="small">
        <li>Claude Code 입력창에 <code>/</code>를 치면 쓸 수 있는 명령 목록이 뜹니다. 이름 일부를 이어서 치면 걸러집니다.</li>
        <li>플러그인 명령의 정식 이름은 <code>/플러그인:명령</code> 형식입니다. 이름이 같은 명령이 여러 플러그인에 있어도 이렇게 구분됩니다.</li>
        <li>명령 뒤에 한 칸 띄우고 인자를 적습니다. 예: <code>/commit-commands:commit 로그인 버그 수정</code></li>
        <li><strong>직접 입력 + 자동 호출</strong> 스킬은 명령을 치지 않아도 요청 내용이 설명과 맞으면 Claude가 알아서 씁니다.</li>
        <li><strong>직접 입력 전용</strong>은 Claude가 자동으로 부르지 않으니 꼭 명령을 입력해야 합니다.</li>
        <li><strong>자동 전용</strong>은 <code>/</code> 메뉴에 나오지 않고, 관련 요청을 하면 Claude가 부릅니다.</li>
        <li>플러그인을 켜거나 끈 뒤에는 새 Claude Code 세션부터 명령 목록에 반영됩니다.</li>
      </ul>
    </details>
  );
}
