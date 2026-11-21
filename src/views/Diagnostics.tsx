import { useHub } from "../hub";
import { DiagnosticItem } from "../components/DiagnosticItem";

export function Diagnostics() {
  const { snap, refresh } = useHub();
  if (!snap) return null;
  const by = (s: string) => snap.diagnostics.filter((d) => d.severity === s);
  const groups = [
    { key: "error", label: "오류" },
    { key: "warning", label: "경고" },
    { key: "info", label: "안내" },
  ];
  return (
    <div className="page">
      <h1>
        진단
        <button className="link" onClick={refresh}>다시 검사</button>
      </h1>
      <p className="muted">
        권장 사용법과 맞지 않는 설정을 찾아냅니다. 터미널에서 플러그인을 설치·삭제하거나 설정 파일을 고치면 자동으로 다시 검사합니다. 마지막 검사:{" "}
        {new Date(snap.scannedAt).toLocaleTimeString()}
      </p>
      {snap.diagnostics.length === 0 && <div className="note ok">문제가 없습니다. 👍</div>}
      {groups.map(({ key, label }) => {
        const list = by(key);
        if (!list.length) return null;
        return (
          <section key={key}>
            <h2>{label} {list.length}건</h2>
            {list.map((d) => <DiagnosticItem key={d.id} d={d} />)}
          </section>
        );
      })}
      <section>
        <h2>검사하는 규칙</h2>
        <ul className="plain small">
          <li>켜져 있지만 설치되지 않은 플러그인 (설정 찌꺼기) — 자동 정리</li>
          <li>설치 폴더가 사라졌거나 plugin.json이 손상된 플러그인 — 다시 설치</li>
          <li>출처 마켓플레이스가 등록되어 있지 않은 플러그인</li>
          <li>마켓플레이스에 새 버전이 있는 플러그인 — 업데이트</li>
          <li>같은 플러그인이 여러 마켓플레이스에서 동시에 켜진 경우</li>
          <li>여러 플러그인에 같은 이름의 스킬·명령이 있어 충돌할 수 있는 경우</li>
          <li>켜진 플러그인이 너무 많아 매 세션 컨텍스트 비용이 커지는 경우</li>
          <li>세션마다 스크립트를 자동 실행하는 훅이 있는 플러그인</li>
          <li>Claude 앱과 터미널 양쪽에서 같은 플러그인을 켠 경우</li>
          <li>settings.json·폴더 설정 파일 형식 오류, 설치 기록을 읽을 수 없는 경우</li>
          <li>등록한 폴더가 사라졌거나, 폴더 설정에서만 켜지고 설치되지 않은 플러그인</li>
        </ul>
      </section>
    </div>
  );
}
