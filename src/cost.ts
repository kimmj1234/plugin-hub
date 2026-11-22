import type { Plugin, PluginUsage } from "./types";

// 매 세션 시스템 프롬프트에 들어가는 스킬·명령·에이전트 설명의 토큰 수를 추정한다.
// 공식 `claude plugin details`의 "Always-on" 값과 비교해 맞춘 근사식(영문 4자≈1토큰, 한글 1자≈1.5토큰, 항목당 약 15토큰).
function textTokens(s: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return ascii / 4 + other * 1.5;
}

export function alwaysOnTokens(p: Plugin): number {
  const seen = new Set<string>();
  let total = 0;
  for (const c of [...p.components.skills, ...p.components.commands, ...p.components.agents]) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    total += textTokens(c.name) + textTokens(c.description) + 15;
  }
  return Math.round(total);
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `${n}`;
}

/// 토큰 수에 기준을 붙인다. 플러그인 하나가 매 세션 차지하는 양 기준(1천 미만 가벼움, 5천 이상 무거움).
export const WEIGHT_LIGHT = 1000;
export const WEIGHT_HEAVY = 5000;
export type Weight = { level: "light" | "medium" | "heavy"; label: string; hint: string };
export function tokenWeight(n: number): Weight {
  const hint = "기준: 1천 토큰 미만 가벼움 · 5천 이상 무거움";
  if (n < WEIGHT_LIGHT) return { level: "light", label: "가벼움", hint };
  if (n < WEIGHT_HEAVY) return { level: "medium", label: "보통", hint };
  return { level: "heavy", label: "무거움", hint };
}

export function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/// 사용 기록은 스킬 호출 이름(plugin.json의 name = displayName)으로 남는다. 설치 id 이름과 다를 수 있어 둘 다 본다.
export function usageOf(usage: Record<string, PluginUsage> | null, p: Plugin): PluginUsage | undefined {
  if (!usage) return undefined;
  const a = usage[p.displayName];
  const b = p.name !== p.displayName ? usage[p.name] : undefined;
  if (a && b) return { plugin: p.displayName, count: a.count + b.count, lastUsed: (a.lastUsed ?? "") > (b.lastUsed ?? "") ? a.lastUsed : b.lastUsed };
  return a ?? b;
}

export const NEW_INSTALL_DAYS = 7;

/// 최근에 설치해서 아직 쓸 기회가 없었던 플러그인 (끄기 추천에서 뺀다)
export function recentlyInstalled(p: Plugin): boolean {
  const d = daysAgo(p.installedAt);
  return d !== null && d < NEW_INSTALL_DAYS;
}

export function usageLabel(u: PluginUsage | undefined, days: number, p?: Plugin): string {
  if ((!u || u.count === 0) && p && recentlyInstalled(p)) return "최근 설치 · 아직 사용 기록 없음";
  if (!u || u.count === 0) return `${days}일간 안 씀`;
  const d = daysAgo(u.lastUsed);
  const when = d === null ? "" : d === 0 ? " · 오늘" : ` · ${d}일 전`;
  return `${days}일간 ${u.count}회${when}`;
}
