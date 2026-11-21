import type { Plugin, ProjectState } from "./types";

export type Source = "local" | "project" | "user" | "none";

export const SOURCE_LABEL: Record<Source, string> = {
  local: "이 폴더(나만) 설정",
  project: "이 폴더(팀 공유) 설정",
  user: "PC 전체 기본값",
  none: "어디서도 켜지 않음",
};

export function effective(p: Plugin, pr: ProjectState, userEnabled: Record<string, boolean>): { on: boolean; source: Source } {
  if (p.id in pr.local) return { on: pr.local[p.id], source: "local" };
  if (p.id in pr.shared) return { on: pr.shared[p.id], source: "project" };
  if (p.id in userEnabled) return { on: userEnabled[p.id], source: "user" };
  return { on: false, source: "none" };
}

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
