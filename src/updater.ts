import { useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

// Plugin Hub 앱 자체 업데이트.
// GitHub Releases의 latest.json을 확인하고, 개발자 서명(minisign)이 맞는 파일만 설치한다.
// 사용자는 다시 내려받거나 설치 프로그램을 따로 실행할 필요가 없다.

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "latest"; checkedAt: number }
  | { kind: "available"; version: string; notes: string; date: string | null }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "downloaded"; version: string }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
let current: Update | null = null;
let currentVersion = "";
const listeners = new Set<() => void>();

function set(s: UpdateState) {
  state = s;
  listeners.forEach((l) => l());
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/// Windows는 설치 프로그램이 앱을 잠시 닫았다가 다시 연다. 그래서 자동 모드에서도 내려받기만 해 두고,
/// 사용자가 누르거나 창을 닫았을 때 설치한다. (macOS는 바로 설치하고 다시 시작하면 적용)
export const IS_WINDOWS = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

export async function appVersion(): Promise<string> {
  if (!currentVersion) currentVersion = await getVersion().catch(() => "");
  return currentVersion;
}

/// 새 버전이 있는지 확인한다. 있으면 "available" 상태가 된다.
export async function checkForUpdate(): Promise<UpdateState> {
  if (state.kind === "downloading" || state.kind === "downloaded" || state.kind === "ready") return state;
  set({ kind: "checking" });
  try {
    const u = await check({ timeout: 20_000 });
    current = u;
    if (!u) {
      set({ kind: "latest", checkedAt: Date.now() });
    } else {
      set({ kind: "available", version: u.version, notes: (u.body ?? "").slice(0, 4000), date: u.date ?? null });
    }
  } catch (e) {
    set({ kind: "error", message: friendly(e) });
  }
  return state;
}

/// Windows 자동 모드: 내려받기만 해 둔다
export async function downloadUpdate(): Promise<void> {
  if (!current || state.kind !== "available") return;
  const u = current;
  let total = 0;
  let got = 0;
  set({ kind: "downloading", version: u.version, percent: null });
  try {
    await u.download((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        set({ kind: "downloading", version: u.version, percent: total ? Math.min(100, Math.round((got / total) * 100)) : null });
      }
    });
    set({ kind: "downloaded", version: u.version });
  } catch (e) {
    set({ kind: "error", message: friendly(e) });
  }
}

/// 내려받아 둔 업데이트를 설치한다 (Windows: 앱이 잠시 닫혔다가 다시 열림)
export async function installDownloaded(): Promise<void> {
  if (!current || state.kind !== "downloaded") return;
  try {
    await current.install();
    set({ kind: "ready", version: current.version });
  } catch (e) {
    set({ kind: "error", message: friendly(e) });
  }
}

/// 내려받아 설치한다. Windows는 설치 프로그램이 앱을 잠시 닫고 바로 다시 연다.
export async function installUpdate(): Promise<void> {
  if (state.kind === "downloaded") return installDownloaded();
  if (!current) {
    const s = await checkForUpdate();
    if (s.kind !== "available" || !current) return;
  }
  const u = current;
  let total = 0;
  let got = 0;
  set({ kind: "downloading", version: u.version, percent: null });
  try {
    await u.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        set({ kind: "downloading", version: u.version, percent: total ? Math.min(100, Math.round((got / total) * 100)) : null });
      }
    });
    set({ kind: "ready", version: u.version });
  } catch (e) {
    set({ kind: "error", message: friendly(e) });
  }
}

export async function restartNow(): Promise<void> {
  await relaunch();
}

function friendly(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e);
  if (/signature/i.test(m)) return "업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다.";
  if (/network|connect|dns|timed? ?out|request/i.test(m)) return "인터넷 연결을 확인한 뒤 다시 시도하세요.";
  return `업데이트를 확인하지 못했습니다: ${m.slice(0, 200)}`;
}
