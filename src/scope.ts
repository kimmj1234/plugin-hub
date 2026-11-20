import type { Plugin, ProjectState } from "./types";

export type Source = "local" | "project" | "user" | "none";

export const SOURCE_LABEL: Record<Source, string> = {
  local: "이 폴더(나만) 설정",
  project: "이 폴더(팀 공유) 설정",
  user: "PC 전체 기본값",
  none: "어디서도 켜지 않음",
};

/**
 * 폴더에서 실제로 적용되는 상태.
 * Claude Code 설정 우선순위: 폴더 개인(settings.local.json) > 폴더 공유(settings.json) > PC 전체(~/.claude/settings.json)
 */
export function effective(p: Plugin, pr: ProjectState, userEnabled: Record<string, boolean>): { on: boolean; source: Source } {
  if (p.id in pr.local) return { on: pr.local[p.id], source: "local" };
  if (p.id in pr.shared) return { on: pr.shared[p.id], source: "project" };
  if (p.id in userEnabled) return { on: userEnabled[p.id], source: "user" };
  return { on: false, source: "none" };
}

/** PC 전체 기본값(user 범위로 설치된 플러그인)의 켜짐 여부 */
export function userEnabledMap(plugins: Plugin[]): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const p of plugins) if (p.surface === "cli" && (p.scope ?? "user") === "user") m[p.id] = p.enabled;
  return m;
}

export type TriValue = "inherit" | "on" | "off";

export function toTri(v: boolean | undefined): TriValue {
  return v === undefined ? "inherit" : v ? "on" : "off";
}

export function fromTri(t: TriValue): boolean | null {
  return t === "inherit" ? null : t === "on";
}
