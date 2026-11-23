import { useMemo, useState } from "react";
import { selectable } from "../a11y";
import { api, errorText } from "../api";
import { useHub } from "../hub";
import { koFor } from "../catalogMeta";
import { SlashHelp, slashItems, type SlashItem } from "../components/SlashCommands";
import { CopyButton } from "../components/CopyButton";
import { KoCommandRow, KoCommandsBar, commandKey as key, useKoCommands } from "../components/KoCommands";
import type { Plugin, Surface } from "../types";
import { SurfaceLabel } from "../surface";

// AI가 외부 플러그인 설명으로 만든 예시는 그대로 믿지 않는다. "예시로 입력"은 이 명령으로 시작하고
// 주소·셸 기호가 없는 짧은 문장일 때만 허용한다 (README에 심은 문장이 채팅 입력창에 들어가지 않게).
export function safeExample(example: string | undefined, call: string): boolean {
  if (!example) return false;
  const t = example.trim();
  return t.length <= 300 && (t === call || t.startsWith(`${call} `)) && !/https?:|www\.|[`$|;&<>\\]/i.test(t) && !/[\r\n]/.test(t);
}

function directItems(p: Plugin): SlashItem[] {
  return slashItems(p).filter((s) => s.kind === "command" || s.comp.userInvocable);
}

export function Commands() {
  const { snap } = useHub();
  const [surface, setSurface] = useState<Surface>("cli");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const plugins = useMemo(
    () =>
      (snap?.plugins ?? [])
        .filter((p) => p.surface === surface && p.installed && directItems(p).length > 0)
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.displayName.localeCompare(b.displayName)),
    [snap, surface],
  );
  const q = query.trim().toLowerCase();
  const shown = plugins.filter(
    (p) =>
      !q ||
      `${p.displayName} ${koFor(p) ?? ""} ${p.description} ${directItems(p).map((s) => `${s.call} ${s.comp.description}`).join(" ")}`
        .toLowerCase()
        .includes(q),
  );
  const current = plugins.find((p) => p.id === selected) ?? shown[0] ?? null;

  if (!snap) return null;
  return (
    <div className="split">
      <div className="pane list-pane">
        <div className="tabs">
          <button className={surface === "cli" ? "active" : ""} onClick={() => { setSurface("cli"); setSelected(null); }}><SurfaceLabel s="cli" /></button>
          <button className={surface === "desktop" ? "active" : ""} onClick={() => { setSurface("desktop"); setSelected(null); }}><SurfaceLabel s="desktop" /></button>
        </div>
        <input className="search" placeholder="하고 싶은 일로 찾기 (예: 커밋, 리뷰, 배포)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="plugin-list">
          {shown.map((p) => (
            <li key={p.id} className={p.id === current?.id ? "selected" : ""} {...selectable(() => setSelected(p.id), p.id === current?.id)}>
              <div className="pl-main">
                <div className="pl-name">{p.displayName}</div>
                {(koFor(p) || p.description) && <div className="pl-desc">{koFor(p) || p.description}</div>}
                <div className="pl-sub">
                  명령 {directItems(p).length}개{!p.enabled && <span className="warn-text"> · 꺼져 있음</span>}
                </div>
              </div>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="empty">{plugins.length === 0 ? "슬래시 명령을 제공하는 플러그인이 없습니다." : "찾는 내용과 맞는 플러그인이 없습니다."}</li>
          )}
        </ul>
      </div>
      <div className="pane detail-pane">
        {current ? <PluginCommands key={current.id + current.surface} p={current} /> : <div className="empty-detail">왼쪽에서 플러그인을 고르면 명령어와 쓰는 법을 한국어로 보여줍니다.</div>}
      </div>
    </div>
  );
}

function PluginCommands({ p }: { p: Plugin }) {
  const { snap, toast } = useHub();
  const items = directItems(p);
  const autoOnly = slashItems(p).filter((s) => s.kind === "skill" && !s.comp.userInvocable);
  const ko = koFor(p);
  const koCmds = useKoCommands(p);
  const { guide, byKey } = koCmds;
  // 설명이 이미 한국어면 "영어로 되어 있다"고 안내하지 않는다
  const described = items.filter((s) => s.comp.description.trim());
  const alreadyKorean = described.length > 0 && described.filter((s) => /[가-힣]/.test(s.comp.description)).length * 2 >= described.length;

  // Claude 앱 채팅에서 쓸 수 있는가: Claude 앱 플러그인이거나, 같은 이름이 Claude 앱에도 설치된 경우
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // Claude 앱 플러그인은 내부 이름이 UUID인 경우가 있어 plugin.json 이름(displayName)으로도 맞춘다
  const inApp = p.surface === "desktop" || !!snap?.plugins.some((x) => x.surface === "desktop" && (same(x.name, p.name) || same(x.displayName, p.displayName)));

  const send = async (text: string) => {
    if (inApp) {
      try {
        await api.openInClaudeApp("chat", text);
        toast("ok", "Claude 앱 새 채팅 입력창에 넣었습니다. 뒤에 내용을 적고 보내세요.");
      } catch (e) {
        toast("error", errorText(e));
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 복사 실패는 아래 안내로 대신한다 */
    }
    toast("info", `이 플러그인은 Claude Code 전용이라 Claude 앱 채팅에는 없습니다. ${text.trim()} 를 복사했으니 터미널이나 Claude 앱 Code 탭 입력창에 붙여 넣으세요.`);
  };

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <h2>{p.displayName}</h2>
          <div className="muted small">명령 {items.length}개{autoOnly.length ? ` · 자동으로 쓰이는 스킬 ${autoOnly.length}개` : ""}</div>
        </div>
      </div>
      {guide?.summary ? <p className="desc ko">{guide.summary}</p> : ko ? <p className="desc ko">{ko}</p> : p.description && <p className="desc">{p.description}</p>}
      {!p.enabled && <div className="note bad small">이 플러그인은 꺼져 있어서 지금은 명령을 쓸 수 없습니다. '목록'에서 켜면 새 세션부터 쓸 수 있습니다.</div>}

      {alreadyKorean && !guide ? (
        <div className="ko-status">
          <span className="muted small">제작자가 한국어로 설명을 써 두었습니다.</span>
          <button className="link" disabled={koCmds.working} onClick={() => koCmds.fill(koCmds.items)}>{koCmds.working ? "만드는 중…" : "AI로 추천 상황·예시 더 보기"}</button>
        </div>
      ) : (
        <KoCommandsBar ko={koCmds} />
      )}

      <SlashHelp />

      <ul className="cmd-list ko-cmds">
        {items.map((s) => {
          const g = byKey.get(key(s.comp.name));
          const insert = `${s.call} `;
          return (
            <KoCommandRow
              key={s.kind + s.comp.name}
              item={s}
              g={g}
              actions={
                <>
                  <button className="primary" disabled={!p.enabled} onClick={() => send(insert)} title={inApp ? "Claude 앱 새 채팅 입력창에 이 명령을 넣습니다 (보내기는 직접)" : "복사한 뒤 붙여 넣을 곳을 안내합니다"}>
                    {inApp ? "바로 입력" : "복사해서 입력"}
                  </button>
                  {safeExample(g?.example, s.call) && inApp && (
                    <button disabled={!p.enabled} onClick={() => send(g!.example)}>예시로 입력</button>
                  )}
                  <CopyButton text={s.call} />
                </>
              }
            />
          );
        })}
      </ul>

      {autoOnly.length > 0 && (
        <details className="fold">
          <summary>명령 없이 자동으로 쓰이는 스킬 {autoOnly.length}개</summary>
          <ul className="plain small">
            {autoOnly.map((s) => (
              <li key={s.comp.name}>
                <strong>{s.comp.name}</strong> — {byKey.get(key(s.comp.name))?.description || s.comp.description}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted tiny">
        "바로 입력"은 Claude 앱 새 채팅 입력창에 명령을 넣기만 하고 보내지는 않습니다. Claude Code 전용 플러그인은 Claude 앱 채팅에 없어서 복사 후 터미널이나 Code 탭에 붙여 넣는 방식으로 안내합니다.
      </p>
    </div>
  );
}
