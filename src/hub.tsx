import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, cliMessage, errorText } from "./api";
import type { Diagnostic, Group, HubState, Plugin, Snapshot } from "./types";

export interface Toast {
  id: number;
  kind: "ok" | "error" | "warning" | "info";
  text: string;
}

interface HubCtx {
  snap: Snapshot | null;
  loading: boolean;
  loadError: string | null;
  groups: Group[];
  toasts: Toast[];
  busy: Record<string, string>;
  refresh: () => Promise<void>;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
  toggle: (p: Plugin, enabled: boolean) => Promise<void>;
  toggleMany: (ps: Plugin[], enabled: boolean) => Promise<void>;
  runFix: (d: Diagnostic) => Promise<void>;
  uninstall: (p: Plugin) => Promise<void>;
  update: (p: Plugin) => Promise<void>;
  setGroups: (groups: Group[]) => Promise<void>;
  withBusy: <T>(key: string, label: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

const Ctx = createContext<HubCtx | null>(null);

export function useHub(): HubCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("HubProvider missing");
  return c;
}

export function HubProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groups, setGroupsState] = useState<Group[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const seenDiag = useRef<Set<string> | null>(null);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.scan();
      // 실시간 감지: 이전 스캔에 없던 오류·경고가 생기면 알린다.
      const important = s.diagnostics.filter((d) => d.severity !== "info");
      if (seenDiag.current) {
        for (const d of important) {
          if (!seenDiag.current.has(d.id)) toast(d.severity === "error" ? "error" : "warning", `새로 감지됨: ${d.title}`);
        }
      }
      seenDiag.current = new Set(important.map((d) => d.id));
      setSnap(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
    api.getGroups().then((s) => setGroupsState(s.groups)).catch(() => {});
    const un = listen("hub://changed", () => refresh());
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      un.then((f) => f());
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const withBusy = useCallback(
    async <T,>(key: string, label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy((b) => ({ ...b, [key]: label }));
      try {
        return await fn();
      } catch (e) {
        toast("error", errorText(e));
        return undefined;
      } finally {
        setBusy((b) => {
          const n = { ...b };
          delete n[key];
          return n;
        });
      }
    },
    [toast],
  );

  const toggle = useCallback(
    async (p: Plugin, enabled: boolean) => {
      // 낙관적 반영 후 파일 감시 이벤트로 실제 상태를 다시 읽는다.
      setSnap((s) =>
        s ? { ...s, plugins: s.plugins.map((x) => (x.id === p.id && x.surface === p.surface ? { ...x, enabled } : x)) } : s,
      );
      try {
        await api.setEnabled(p.id, enabled, p.scope);
        toast("ok", `${p.displayName} ${enabled ? "켬" : "끔"} · 새 Claude Code 세션부터 적용됩니다`);
      } catch (e) {
        toast("error", errorText(e));
      }
      refresh();
    },
    [refresh, toast],
  );

  const toggleMany = useCallback(
    async (ps: Plugin[], enabled: boolean) => {
      const targets = ps.filter((p) => p.toggleable && p.enabled !== enabled);
      for (const p of targets) {
        try {
          await api.setEnabled(p.id, enabled, p.scope);
        } catch (e) {
          toast("error", `${p.displayName}: ${errorText(e)}`);
        }
      }
      if (targets.length) toast("ok", `${targets.length}개 플러그인을 ${enabled ? "켰" : "껐"}습니다`);
      refresh();
    },
    [refresh, toast],
  );

  const reportCli = useCallback(
    (label: string, r: { ok: boolean } & Parameters<typeof cliMessage>[0]) => {
      toast(r.ok ? "ok" : "error", `${label}: ${cliMessage(r)}`);
    },
    [toast],
  );

  const update = useCallback(
    async (p: Plugin) => {
      const r = await withBusy(p.id, "업데이트 중", () => api.update(p.id, p.scope));
      if (r) reportCli(`${p.displayName} 업데이트`, r);
      refresh();
    },
    [withBusy, reportCli, refresh],
  );

  const uninstall = useCallback(
    async (p: Plugin) => {
      const r = await withBusy(p.id, "삭제 중", () => api.uninstall(p.id, p.scope));
      if (r) reportCli(`${p.displayName} 삭제`, r);
      refresh();
    },
    [withBusy, reportCli, refresh],
  );

  const runFix = useCallback(
    async (d: Diagnostic) => {
      if (!d.fix || !snap) return;
      const p = snap.plugins.find((x) => x.id === d.pluginId && x.surface === "cli");
      switch (d.fix.kind) {
        case "remove-setting":
          if (d.pluginId) {
            await withBusy(d.id, "정리 중", () => api.removeSetting(d.pluginId!));
            toast("ok", "설정에서 항목을 제거했습니다");
          }
          break;
        case "reinstall":
          if (d.pluginId) {
            const r = await withBusy(d.id, "설치 중", () => api.install(d.pluginId!));
            if (r) reportCli("다시 설치", r);
          }
          break;
        case "update":
          if (p) await update(p);
          break;
        case "disable":
          if (p) await toggle(p, false);
          break;
      }
      refresh();
    },
    [snap, withBusy, toast, reportCli, update, toggle, refresh],
  );

  const setGroups = useCallback(
    async (g: Group[]) => {
      setGroupsState(g);
      try {
        await api.saveGroups({ groups: g } satisfies HubState);
      } catch (e) {
        toast("error", `폴더 저장 실패: ${errorText(e)}`);
      }
    },
    [toast],
  );

  return (
    <Ctx.Provider
      value={{ snap, loading, loadError, groups, toasts, busy, refresh, toast, dismissToast, toggle, toggleMany, runFix, uninstall, update, setGroups, withBusy }}
    >
      {children}
    </Ctx.Provider>
  );
}
