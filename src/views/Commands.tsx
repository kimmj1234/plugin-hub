import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../api";
import { useHub } from "../hub";
import { koDescription } from "../catalogMeta";
import { InvokeBadges, SlashHelp, slashItems, type SlashItem } from "../components/SlashCommands";
import { CopyButton } from "../components/CopyButton";
import type { Guide, GuideCommand, Plugin, Surface } from "../types";

// AI 가이드의 명령 이름("/plugin:cmd <인자>")과 플러그인 구성 요소 이름을 맞춘다.
function key(s: string): string {
  return s.trim().split(/\s/)[0].replace(/^\//, "").split(":").pop()!.toLowerCase();
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
      `${p.displayName} ${koDescription(p.id) ?? ""} ${p.description} ${directItems(p).map((s) => `${s.call} ${s.comp.description}`).join(" ")}`
        .toLowerCase()
        .includes(q),
  );
  const current = plugins.find((p) => p.id === selected) ?? shown[0] ?? null;

  if (!snap) return null;
  return (
    <div className="split">
      <div className="pane list-pane">
        <div className="tabs">
          <button className={surface === "cli" ? "active" : ""} onClick={() => { setSurface("cli"); setSelected(null); }}>터미널·Claude Code</button>
          <button className={surface === "desktop" ? "active" : ""} onClick={() => { setSurface("desktop"); setSelected(null); }}>Claude 앱</button>
        </div>
        <input className="search" placeholder="하고 싶은 일로 찾기 (예: 커밋, 리뷰, 배포)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ul className="plugin-list">
          {shown.map((p) => (
            <li key={p.id} className={p.id === current?.id ? "selected" : ""} onClick={() => setSelected(p.id)}>
              <div className="pl-main">
                <div className="pl-name">{p.displayName}</div>
                {(koDescription(p.id) || p.description) && <div className="pl-desc">{koDescription(p.id) || p.description}</div>}
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
  const [guide, setGuide] = useState<Guide | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = directItems(p);
  const autoOnly = slashItems(p).filter((s) => s.kind === "skill" && !s.comp.userInvocable);
  const ko = koDescription(p.id);

  useEffect(() => {
    api.getGuide(p.id, p.version).then(setGuide).catch(() => {});
  }, [p.id, p.version]);

  const byKey = new Map<string, GuideCommand>((guide?.commands ?? []).map((c) => [key(c.command), c]));

  // Claude 앱 채팅에서 쓸 수 있는가: Claude 앱 플러그인이거나, 같은 이름이 Claude 앱에도 설치된 경우
  const inApp = p.surface === "desktop" || !!snap?.plugins.some((x) => x.surface === "desktop" && x.name === p.name);

  const generate = async () => {
    setWorking(true);
    setError(null);
    try {
      const s = await api.aiStatus();
      if (!s.loggedIn) {
        setError(s.detail);
        return;
      }
      const g = await api.generateGuide({ id: p.id, surface: p.surface, version: p.version, name: p.displayName, description: p.description });
      setGuide(g);
      toast("ok", `${p.displayName} 명령어 설명을 한국어로 만들었습니다`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  };

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

      {guide ? (
        <div className="ko-status">
          <span className="badge ai">AI 한국어 설명</span>
          <span className="muted small">{new Date(guide.generatedAt).toLocaleDateString()} 생성</span>
          <button className="link" disabled={working} onClick={generate}>{working ? "다시 만드는 중…" : "다시 만들기"}</button>
        </div>
      ) : (
        <div className="ko-cta">
          <div>
            <strong>명령어 설명이 영어로 되어 있습니다.</strong>
            <div className="muted small">내 Claude 계정으로 한국어 설명과 사용 예시를 만들어 저장합니다. 한 번 만들면 다시 쓰고, 보통 30초~1분 걸립니다.</div>
          </div>
          <button className="primary" disabled={working} onClick={generate}>{working ? "만드는 중…" : "한국어로 보기"}</button>
        </div>
      )}
      {error && <div className="note bad small">{error}</div>}

      <SlashHelp />

      <ul className="cmd-list ko-cmds">
        {items.map((s) => {
          const g = byKey.get(key(s.comp.name));
          const insert = `${s.call} `;
          return (
            <li key={s.kind + s.comp.name} className="cmd">
              <div className="cmd-line">
                <code className="cmd-name">
                  {s.call}
                  {s.comp.argumentHint && <span className="arg"> {s.comp.argumentHint}</span>}
                </code>
                <InvokeBadges c={s.comp} kind={s.kind} />
              </div>
              <div className="cmd-desc">{g?.description || s.comp.description || "설명이 없습니다."}</div>
              {g?.description && s.comp.description && <div className="muted tiny">원문: {s.comp.description}</div>}
              {g?.usage && <div className="cmd-usage"><strong>쓰는 법</strong> {g.usage}</div>}
              {s.comp.argumentHint && (
                <div className="muted small">
                  입력 형식: <code>{s.call} {s.comp.argumentHint}</code> — <code>&lt;…&gt;</code>는 꼭 넣는 값, <code>[…]</code>는 생략 가능
                </div>
              )}
              {g?.example && <div className="example">예시: <code>{g.example}</code></div>}
              {!g?.example && s.comp.examples.length > 0 && (
                <div className="example">이렇게 말해도 됩니다: {s.comp.examples.slice(0, 3).map((e, i) => <q key={i}>{e}</q>)}</div>
              )}
              <div className="cmd-actions">
                <button className="primary" disabled={!p.enabled} onClick={() => send(insert)} title={inApp ? "Claude 앱 새 채팅 입력창에 이 명령을 넣습니다 (보내기는 직접)" : "복사한 뒤 붙여 넣을 곳을 안내합니다"}>
                  {inApp ? "바로 입력" : "복사해서 입력"}
                </button>
                {g?.example?.trim().startsWith("/") && inApp && (
                  <button disabled={!p.enabled} onClick={() => send(g.example)}>예시로 입력</button>
                )}
                <CopyButton text={s.call} />
              </div>
            </li>
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
