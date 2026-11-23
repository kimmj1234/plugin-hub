import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../api";
import { useHub } from "../hub";
import type { Guide, GuideCommand, Plugin } from "../types";
import { InvokeBadges, slashItems, type SlashItem } from "./SlashCommands";
import { CopyButton } from "./CopyButton";

/** AI 가이드의 명령 이름("/plugin:cmd <인자>")과 플러그인 구성 요소 이름을 맞춘다. */
export function commandKey(s: string): string {
  return s.trim().split(/\s/)[0].replace(/^\//, "").split(":").pop()!.toLowerCase();
}

/** 한 번에 Claude에게 맡기는 명령 수. 많으면 답이 잘리고, 적으면 호출이 많아진다. */
const BATCH = 20;

/** 플러그인 명령마다 한국어 설명·추천 상황을 불러오고, 없는 것을 나눠 만든다. */
export function useKoCommands(p: Plugin) {
  const { toast } = useHub();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setGuide(null);
    setError(null);
    api.getGuide(p.id, p.version).then((g) => alive.current && setGuide(g)).catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [p.id, p.version]);

  const items = slashItems(p);
  const byKey = new Map<string, GuideCommand>((guide?.commands ?? []).map((c) => [commandKey(c.command), c]));
  // 설명이 없거나, 예전 형식이라 "추천 상황"이 비어 있는 명령
  const missing = items.filter((s) => !byKey.get(commandKey(s.comp.name))?.when);

  const fill = useCallback(
    async (targets: SlashItem[]) => {
      if (!targets.length) return;
      setWorking(true);
      setError(null);
      try {
        const s = await api.aiStatus();
        if (!s.loggedIn) {
          setError(s.detail);
          return;
        }
        const names = [...new Set(targets.map((t) => t.comp.name))];
        setProgress({ done: 0, total: names.length });
        for (let i = 0; i < names.length; i += BATCH) {
          const g = await api.generateCommandGuide(p.id, names.slice(i, i + BATCH));
          if (!alive.current) return;
          setGuide(g);
          setProgress({ done: Math.min(i + BATCH, names.length), total: names.length });
        }
        toast("ok", `${p.displayName} 명령 ${names.length}개의 한국어 설명을 만들었습니다`);
      } catch (e) {
        if (alive.current) setError(errorText(e));
      } finally {
        if (alive.current) {
          setWorking(false);
          setProgress(null);
        }
      }
    },
    [p.id, p.displayName, toast],
  );

  return { guide, setGuide, byKey, items, missing, working, progress, error, fill };
}

export type KoCommandsState = ReturnType<typeof useKoCommands>;

/** 명령 목록 위의 안내: 아직 한국어 설명이 없는 명령 수와 만들기 버튼, 진행 상황 */
export function KoCommandsBar({ ko, label = "명령" }: { ko: KoCommandsState; label?: string }) {
  const { missing, working, progress, error, fill, guide, items } = ko;
  const done = items.length - missing.length;
  return (
    <>
      {missing.length > 0 ? (
        <div className="ko-cta">
          <div>
            <strong>{done > 0 ? `${label} ${missing.length}개는 아직 한국어 설명이 없습니다.` : `${label} ${items.length}개를 언제 쓰면 좋은지 한국어로 볼 수 있습니다.`}</strong>
            <div className="muted small">
              내 Claude 계정으로 명령마다 한국어 설명, <b>이럴 때 추천</b>, 쓰는 법, 예시를 만들어 저장합니다. {BATCH}개씩 나눠 만들며 {BATCH}개에 30초~1분쯤 걸립니다.
            </div>
            {progress && (
              <div className="ko-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="한국어 설명 만드는 중">
                <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            )}
          </div>
          <button className="primary" disabled={working} onClick={() => fill(missing)}>
            {working ? (progress ? `만드는 중… ${progress.done}/${progress.total}` : "확인 중…") : done > 0 ? "나머지 한국어로 보기" : "한국어로 보기"}
          </button>
        </div>
      ) : (
        guide && (
          <div className="ko-status">
            <span className="badge ai" title="플러그인 제작자가 쓴 설명을 AI가 한국어로 옮기고 정리한 것입니다. 실제 동작은 원문과 다를 수 있습니다.">AI 한국어 설명</span>
            <span className="muted small">명령 {items.length}개 모두</span>
            <button className="link" disabled={working} onClick={() => fill(items)}>
              {working ? (progress ? `다시 만드는 중… ${progress.done}/${progress.total}` : "확인 중…") : "다시 만들기"}
            </button>
          </div>
        )
      )}
      {error && <div className="note bad small">{error}</div>}
    </>
  );
}

/** 한국어 설명이 있으면 그것을 먼저, 원문은 작게 보여 주는 명령 한 줄 */
export function KoCommandRow({ item, g, actions }: { item: SlashItem; g?: GuideCommand; actions?: React.ReactNode }) {
  const { comp: c, kind, call } = item;
  const ko = g?.description;
  return (
    <li className="cmd">
      <div className="cmd-line">
        <code className="cmd-name">
          {call}
          {c.argumentHint && <span className="arg"> {c.argumentHint}</span>}
        </code>
        {!actions && (kind === "command" || c.userInvocable) && <CopyButton text={call} />}
        <InvokeBadges c={c} kind={kind} />
      </div>
      <div className="cmd-desc">{ko || c.description || "설명이 없습니다."}</div>
      {g?.when && (
        <div className="cmd-when">
          <strong>이럴 때 추천</strong> {g.when.replace(/^이럴 때 추천\s*[:：]\s*/, "")}
        </div>
      )}
      {g?.usage && <div className="cmd-usage"><strong>쓰는 법</strong> {g.usage}</div>}
      {c.argumentHint && (
        <div className="muted small">
          입력 형식: <code>{call} {c.argumentHint}</code> — <code>&lt;…&gt;</code>는 꼭 넣는 값, <code>[…]</code>는 생략 가능
        </div>
      )}
      {g?.example && <div className="example">예시: <code>{g.example}</code></div>}
      {!g?.example && c.examples.length > 0 && (
        <div className="example">이렇게 말해도 됩니다: {c.examples.slice(0, 3).map((e, i) => <q key={i}>{e}</q>)}</div>
      )}
      {ko && c.description && (
        <details className="cmd-original">
          <summary>원문 보기</summary>
          <div className="muted small">{c.description}</div>
        </details>
      )}
      {actions && <div className="cmd-actions">{actions}</div>}
    </li>
  );
}
