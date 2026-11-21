import { useEffect, useState } from "react";
import { api, errorText } from "../api";
import { useHub } from "../hub";
import type { AiStatus, Guide, Surface } from "../types";
import { CopyButton } from "./CopyButton";

let statusCache: AiStatus | null = null;

export function GuidePanel(props: {
  id: string;
  version: string | null;
  surface?: Surface;
  name?: string;
  description?: string;
  installed: boolean;
}) {
  const { toast } = useHub();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [status, setStatus] = useState<AiStatus | null>(statusCache);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGuide(null);
    setError(null);
    api.getGuide(props.id, props.version).then(setGuide).catch(() => {});
  }, [props.id, props.version]);

  const checkStatus = async () => {
    const s = await api.aiStatus();
    statusCache = s;
    setStatus(s);
    return s;
  };

  useEffect(() => {
    if (!statusCache) checkStatus().catch(() => {});
  }, []);

  const generate = async () => {
    setWorking(true);
    setError(null);
    try {
      const s = await checkStatus();
      if (!s.loggedIn) {
        setError(s.detail);
        return;
      }
      const g = await api.generateGuide({
        id: props.id,
        surface: props.surface,
        version: props.version,
        name: props.name,
        description: props.description,
      });
      setGuide(g);
      toast("ok", "한국어 가이드를 만들었습니다");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  };

  const login = async () => {
    try {
      await api.openLogin();
      toast("info", "터미널에서 로그인을 마친 뒤 '다시 확인'을 누르세요");
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  if (guide) {
    return (
      <div className="guide">
        <div className="guide-head">
          <span className="badge ai">AI 한국어 가이드</span>
          <span className="muted small">{new Date(guide.generatedAt).toLocaleDateString()} 생성{guide.version ? ` · v${guide.version} 기준` : ""}</span>
          <button className="link" disabled={working} onClick={generate}>{working ? "다시 만드는 중…" : "다시 만들기"}</button>
        </div>
        <p className="desc">{guide.summary}</p>
        {guide.useCases.length > 0 && (
          <>
            <h4>이럴 때 쓰세요</h4>
            <ul>{guide.useCases.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </>
        )}
        {guide.commands.length > 0 && (
          <>
            <h4>명령어 자세히</h4>
            <ul className="cmd-list">
              {guide.commands.map((c, i) => (
                <li key={i} className="cmd">
                  <div className="cmd-line">
                    <code className="cmd-name">{c.command}</code>
                    <CopyButton text={c.command.split(" ")[0]} />
                  </div>
                  <div>{c.description}</div>
                  {c.usage && <div className="muted small">{c.usage}</div>}
                  {c.example && <div className="example">예시: <code>{c.example}</code></div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {guide.tips.length > 0 && (
          <>
            <h4>요령</h4>
            <ul>{guide.tips.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </>
        )}
        {guide.cautions.length > 0 && (
          <>
            <h4>주의할 점</h4>
            <ul className="cautions">{guide.cautions.map((u, i) => <li key={i}>{u}</li>)}</ul>
          </>
        )}
        <p className="muted small">AI가 플러그인 정보를 바탕으로 만든 설명입니다. 정확한 동작은 원문과 README를 함께 확인하세요.</p>
      </div>
    );
  }

  return (
    <div className="guide empty-guide">
      <p className="small">
        {props.installed
          ? "설치된 파일(명령어·스킬·README)을 근거로 한국어 사용 설명서를 만듭니다."
          : "설치 전이라 이름과 설명만으로 한국어 요약을 만듭니다. 설치하면 명령어까지 포함한 자세한 가이드를 만들 수 있습니다."}
        {" "}내 Claude Code 계정으로 실행되며, 한 번 만들면 저장해 두고 다시 씁니다.
      </p>
      <div className="actions">
        <button className="primary" disabled={working} onClick={generate}>
          {working ? "만드는 중… (최대 1~2분)" : "AI로 한국어 가이드 만들기"}
        </button>
        {status && status.cliFound && !status.loggedIn && (
          <>
            <button onClick={login}>Claude Code 로그인</button>
            <button className="link" onClick={() => checkStatus()}>다시 확인</button>
          </>
        )}
      </div>
      {error && <div className="note bad small">{error}</div>}
    </div>
  );
}
