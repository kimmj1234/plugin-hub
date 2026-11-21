import type { Surface } from "./types";

// 플러그인이 쓰이는 곳은 저장 위치 기준으로 둘이다.
// - Claude Code: 터미널과 Claude 앱의 Code 탭이 같은 ~/.claude 설정을 함께 쓴다.
// - Claude 채팅: Claude 앱의 채팅·Cowork. 계정에 저장되어 기기 사이에 동기화된다.
export const SURFACE: Record<Surface, { title: string; where: string; hint: string }> = {
  cli: {
    title: "Claude Code",
    where: "터미널 · Claude 앱 Code 탭",
    hint: "터미널의 Claude Code와 Claude 앱의 Code 탭이 함께 쓰는 플러그인입니다. 이 PC의 ~/.claude 폴더에 설치됩니다.",
  },
  desktop: {
    title: "Claude 채팅",
    where: "Claude 앱 채팅 · Cowork",
    hint: "Claude 앱의 채팅과 Cowork에서 쓰는 플러그인입니다. Claude 계정에 저장되어 다른 기기와 동기화됩니다.",
  },
};

export function SurfaceLabel({ s, count, countSuffix = "" }: { s: Surface; count?: number; countSuffix?: string }) {
  return (
    <span className="surface-label" title={SURFACE[s].hint}>
      <span className="surface-title">
        {SURFACE[s].title}
        {count !== undefined && <span className="count">{count}{countSuffix}</span>}
      </span>
      <span className="surface-where">{SURFACE[s].where}</span>
    </span>
  );
}
