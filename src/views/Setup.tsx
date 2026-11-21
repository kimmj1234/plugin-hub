import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errorText } from "../api";
import { PRIVACY_VERSION, useHub } from "../hub";
import type { AiStatus, Prefs } from "../types";
import { IS_WINDOWS } from "../updater";

export const PRIVACY_URL = "https://github.com/kimmj1234/plugin-hub/blob/main/PRIVACY.md";

type Status = "ok" | "need" | "optional" | "na";

function Row({ status, title, desc, children }: { status: Status; title: string; desc: string; children?: React.ReactNode }) {
  const label = { ok: "준비됨", need: "설정 필요", optional: "선택", na: "해당 없음" }[status];
  return (
    <li className={`setup-row ${status}`}>
      <span className={`setup-state ${status}`}>{label}</span>
      <div className="setup-body">
        <strong>{title}</strong>
        <div className="muted small">{desc}</div>
        {children && <div className="setup-actions">{children}</div>}
      </div>
    </li>
  );
}

/// 첫 실행 설정. 개인정보 안내 동의 → 권한·준비 상태 점검 → 실행·업데이트 방식.
/// 운영체제가 앱이 스스로 켜지 못하게 막아 둔 권한(macOS 손쉬운 사용 등)은 여기서 안내하고,
/// 사용자가 직접 켜기 전까지 해당 기능은 잠가 둔다.
export function Setup({ onDone, reopen }: { onDone: () => void; reopen?: boolean }) {
  const { prefs, setPrefs, perm, refreshPerm, toast } = useHub();
  const [step, setStep] = useState(reopen ? 1 : 0);
  const [agree, setAgree] = useState(prefs.privacyAck >= PRIVACY_VERSION);
  const [usage, setUsage] = useState(prefs.usageConsent);
  const [launch, setLaunch] = useState(prefs.launchAtLogin);
  const [autoPlugins, setAutoPlugins] = useState(prefs.autoUpdatePlugins);
  const [appUpdate, setAppUpdate] = useState<Prefs["appUpdate"]>(prefs.appUpdate);
  const [ai, setAi] = useState<AiStatus | null>(null);

  // 권한 화면에서는 2초마다 다시 확인해, 사용자가 설정에서 켜면 바로 "준비됨"으로 바뀌게 한다.
  useEffect(() => {
    if (step !== 1) return;
    refreshPerm();
    api.aiStatus().then(setAi).catch(() => {});
    const t = setInterval(() => refreshPerm(), 2000);
    return () => clearInterval(t);
  }, [step, refreshPerm]);

  const finish = async () => {
    await setPrefs({
      ...prefs,
      onboardingDone: true,
      privacyAck: PRIVACY_VERSION,
      usageConsent: usage,
      launchAtLogin: launch,
      autoUpdatePlugins: autoPlugins,
      appUpdate,
    });
    onDone();
  };

  const isMac = perm?.os === "macos";
  const steps = ["개인정보 안내", "권한과 준비", "실행과 업데이트"];

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-head">
          <img src="/icon.png" alt="" width="40" height="40" />
          <div>
            <h1>Plugin Hub {reopen ? "권한·설정 점검" : "시작하기"}</h1>
            <ol className="setup-steps">
              {steps.map((s, i) => (
                <li key={s} className={i === step ? "active" : i < step ? "done" : ""}>{i + 1}. {s}</li>
              ))}
            </ol>
          </div>
        </div>

        {step === 0 && (
          <section className="setup-section">
            <h2>Plugin Hub가 하는 일과 다루는 정보</h2>
            <ul className="setup-list">
              <li><strong>이 PC 안에서만 동작합니다.</strong> 개발자 서버가 없고, 사용 통계·광고·추적을 수집하지 않습니다.</li>
              <li><strong>읽는 것</strong>: Claude Code 설정과 설치 기록(~/.claude), 설치된 플러그인 파일, Claude 앱의 플러그인 목록 파일, 직접 등록한 작업 폴더의 .claude 설정.</li>
              <li><strong>바꾸는 것</strong>: 플러그인을 켜고 끄거나 설정 문제를 고칠 때 Claude Code 설정 파일과 등록한 폴더의 설정 파일(수정 전 자동 백업). 설치·삭제·업데이트는 공식 Claude Code가 실행합니다.</li>
              <li><strong>인터넷 연결</strong>: 플러그인 목록 갱신(30분마다, 설정에서 끄기 가능)과 설치(공식 Claude Code가 GitHub·마켓플레이스에 접속), 앱 업데이트 확인(GitHub, 설정에서 끄기 가능). "한국어로 보기"를 누를 때만 플러그인 설명이 내 Claude 계정을 통해 Anthropic으로 전송됩니다.</li>
              {isMac && <li><strong>손쉬운 사용 권한</strong>(허용한 경우): Claude 채팅 플러그인 자동 설치에서 Claude 앱의 검색창과 "추가" 버튼을 대신 누를 때만 씁니다. 다른 앱은 조작하지 않습니다.</li>}
              <li>Plugin Hub는 Anthropic과 관계없는 개인 오픈소스 프로젝트입니다. Claude는 Anthropic의 상표입니다.</li>
            </ul>
            <label className="setup-check">
              <input type="checkbox" checked={usage} onChange={(e) => setUsage(e.target.checked)} />
              <span>
                <strong>(선택) 사용 분석 켜기</strong>
                <span className="muted small"> — 이 PC의 Claude Code 대화 기록에서 플러그인 스킬·명령 호출 횟수만 세어 "안 쓰는 플러그인"을 알려 줍니다. 대화 내용은 저장하거나 보내지 않습니다. 설정에서 언제든 끌 수 있습니다.</span>
              </span>
            </label>
            <label className="setup-check required">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span><strong>(필수) 위 내용을 확인했고 동의합니다.</strong></span>
            </label>
            <div className="setup-nav">
              <button className="link" onClick={() => openUrl(PRIVACY_URL).catch(() => {})}>개인정보 처리방침 전문 보기</button>
              <button className="primary" disabled={!agree} onClick={() => setStep(1)}>다음</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="setup-section">
            <h2>필요한 권한과 준비 상태</h2>
            <p className="muted small">운영체제 보안 정책상 앱이 스스로 켤 수 없는 권한은 직접 켜야 합니다. 켜기 전까지 그 권한이 필요한 기능만 잠기고, 나머지는 쓸 수 있습니다.</p>
            <ul className="setup-rows">
              <Row
                status={perm?.cli ? "ok" : "need"}
                title="Claude Code"
                desc={perm?.cli ? `찾았습니다 (${perm.cli.kind === "terminal" ? "터미널용" : "Claude 앱 내장"}${perm.cli.version ? ` v${perm.cli.version}` : ""}). 플러그인 설치·삭제·업데이트에 씁니다.` : "플러그인 설치·삭제·업데이트에 필요합니다. Claude 앱 또는 터미널용 Claude Code를 설치한 뒤 다시 확인하세요."}
              >
                {!perm?.cli && (
                  <>
                    <button onClick={() => openUrl("https://claude.com/download").catch(() => {})}>Claude 앱 내려받기</button>
                    <button className="link" onClick={() => refreshPerm()}>다시 확인</button>
                  </>
                )}
              </Row>
              {isMac ? (
                <Row
                  status={perm?.accessibility ? "ok" : "need"}
                  title="손쉬운 사용 권한 (macOS)"
                  desc={perm?.accessibility ? "허용되어 있습니다. Claude 채팅 플러그인을 클릭 없이 자동 설치할 수 있습니다." : "Claude 채팅 플러그인 자동 설치에 필요합니다. '권한 요청'을 누른 뒤 시스템 설정 > 개인정보 보호 및 보안 > 손쉬운 사용에서 Plugin Hub를 켜세요. 켜면 이 화면이 자동으로 바뀝니다."}
                >
                  {!perm?.accessibility && (
                    <>
                      <button className="primary" onClick={() => api.requestAccessibility().catch((e) => toast("error", errorText(e)))}>권한 요청</button>
                      <button onClick={() => api.openAccessibilitySettings().catch((e) => toast("error", errorText(e)))}>설정 열기</button>
                    </>
                  )}
                </Row>
              ) : (
                <Row status="na" title="Claude 채팅 플러그인 자동 설치" desc="Windows에서는 'Claude 앱에 설치'를 누르면 Claude 앱의 디렉터리를 열고 무엇을 누를지 안내합니다. 별도 권한이 필요 없습니다." />
              )}
              <Row
                status={ai?.loggedIn ? "ok" : "optional"}
                title="Claude 계정 로그인"
                desc={ai?.loggedIn ? "로그인되어 있습니다. 명령어 한국어 설명을 만들 수 있습니다." : "명령어 한국어 설명(AI)을 만들 때만 필요합니다. 나중에 해도 됩니다."}
              >
                {ai && !ai.loggedIn && ai.cliFound && (
                  <>
                    <button onClick={() => api.openLogin().catch((e) => toast("error", errorText(e)))}>로그인</button>
                    <button className="link" onClick={() => api.aiStatus().then(setAi).catch(() => {})}>다시 확인</button>
                  </>
                )}
              </Row>
              <Row
                status={perm?.desktopInstalled ? "ok" : "optional"}
                title="Claude 앱"
                desc={perm?.desktopInstalled ? "설치되어 있습니다. Claude 채팅 플러그인을 보고 설치할 수 있습니다." : "Claude 채팅 플러그인을 쓰려면 필요합니다."}
              />
            </ul>
            <div className="setup-nav">
              {!reopen && <button className="link" onClick={() => setStep(0)}>이전</button>}
              <button className="primary" onClick={() => setStep(2)}>다음</button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="setup-section">
            <h2>실행과 업데이트</h2>
            <label className="setup-check">
              <input type="checkbox" checked={launch} onChange={(e) => setLaunch(e.target.checked)} />
              <span><strong>로그인할 때 자동 실행</strong><span className="muted small"> — 창 없이 뒤에서 실행되어 설정 문제와 새 버전을 계속 확인합니다.</span></span>
            </label>
            <label className="setup-check">
              <input type="checkbox" checked={autoPlugins} onChange={(e) => setAutoPlugins(e.target.checked)} />
              <span><strong>플러그인 업데이트 자동 설치</strong><span className="muted small"> — Claude Code 플러그인에 새 버전이 나오면 바로 업데이트합니다.</span></span>
            </label>
            <div className="setup-radio">
              <strong>Plugin Hub 앱 업데이트</strong>
              {([
                ["auto", "자동으로 받아 설치 (권장)", IS_WINDOWS ? "새 버전을 미리 내려받아 두고, 창을 닫을 때 설치합니다." : "새 버전을 내려받아 설치하고, 다시 시작하면 적용됩니다."],
                ["notify", "알림만", "새 버전이 있으면 알려 주고, 누르면 설치합니다."],
                ["off", "확인하지 않음", "설정에서 직접 확인할 때만 찾습니다."],
              ] as const).map(([v, label, desc]) => (
                <label key={v} className="radio">
                  <input type="radio" name="appUpdate" checked={appUpdate === v} onChange={() => setAppUpdate(v)} />
                  <span><strong>{label}</strong><span className="muted small"> — {desc}</span></span>
                </label>
              ))}
              <p className="muted small">업데이트 파일은 GitHub에서 받고, 개발자 서명을 확인한 뒤에만 설치합니다. 따로 내려받아 다시 설치할 필요가 없습니다.</p>
            </div>
            <div className="setup-nav">
              <button className="link" onClick={() => setStep(1)}>이전</button>
              <button className="primary" disabled={!agree} onClick={finish}>{reopen ? "저장" : "시작하기"}</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
