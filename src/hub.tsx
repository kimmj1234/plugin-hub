import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, cliMessage, errorText } from "./api";
import type { Catalog, Diagnostic, Group, Plugin, Prefs, ProjectFolder, Snapshot } from "./types";

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
  catalog: Catalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  /** 마켓플레이스 원본까지 다시 받아 목록을 갱신 */
  refreshCatalog: (remote: boolean) => Promise<void>;
  projects: ProjectFolder[];
  prefs: Prefs;
  setPrefs: (p: Prefs) => Promise<void>;
  addProject: (path: string) => Promise<void>;
  removeProject: (path: string) => Promise<void>;
  /** 폴더별 설정 변경. value: true 켬 / false 끔 / null 기본값 따름 */
  setFolder: (pluginId: string, projectPath: string, scope: "project" | "local", value: boolean | null) => Promise<void>;
}

const DEFAULT_PREFS: Prefs = { defaultInstallScope: "user", defaultInstallProject: null, remoteRefreshMinutes: 30 };



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
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const flagged = useRef<Set<string> | null>(null);
  const catalogBusy = useRef(false);
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
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
    api
      .getState()
      .then((s) => {
        setGroupsState(s.groups);
        setProjects(s.projects);
        setPrefsState(s.prefs);
      })
      .catch(() => {});
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
        await api.setEnabled(p.id, enabled, p.scope, p.projectPath);
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
          await api.setEnabled(p.id, enabled, p.scope, p.projectPath);
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
      const r = await withBusy(p.id, "업데이트 중", () => api.update(p.id, p.scope, p.projectPath));
      if (r) reportCli(`${p.displayName} 업데이트`, r);
      refresh();
    },
    [withBusy, reportCli, refresh],
  );

  const uninstall = useCallback(
    async (p: Plugin) => {
      const r = await withBusy(p.id, "삭제 중", () => api.uninstall(p.id, p.scope, p.projectPath));
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

  const refreshCatalog = useCallback(
    async (remote: boolean) => {
      if (catalogBusy.current) return;
      catalogBusy.current = true;
      setCatalogLoading(true);
      try {
        if (remote) {
          try {
            await api.updateMarketplaces();
          } catch (e) {
            // 네트워크 문제 등으로 실패해도 로컬 목록은 보여준다
            console.warn(e);
          }
        }
        const c = await api.catalog(true);
        // 실시간 반영: 이번에 새로 생겼거나 업데이트된 플러그인을 알린다.
        const now = new Set(c.entries.filter((e) => e.isNew || e.updated).map((e) => e.pluginId));
        if (flagged.current) {
          const fresh = c.entries.filter((e) => now.has(e.pluginId) && !flagged.current!.has(e.pluginId));
          const n = fresh.filter((e) => e.isNew).length;
          const u = fresh.length - n;
          if (n || u) toast("info", `플러그인 찾기: 새 플러그인 ${n}개, 업데이트 ${u}개가 반영되었습니다`);
        }
        flagged.current = now;
        setCatalog(c);
        setCatalogError(null);
      } catch (e) {
        setCatalogError(errorText(e));
      } finally {
        catalogBusy.current = false;
        setCatalogLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    refreshCatalog(false);
    const un = listen("hub://catalog-changed", () => refreshCatalog(false));
    return () => {
      un.then((f) => f());
    };
  }, [refreshCatalog]);

  // 마켓플레이스 원본 자동 확인 (설정에서 주기 변경, 0이면 끔)
  useEffect(() => {
    if (!prefs.remoteRefreshMinutes) return;
    const timer = setInterval(() => refreshCatalog(true), prefs.remoteRefreshMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshCatalog, prefs.remoteRefreshMinutes]);

  const setPrefs = useCallback(
    async (p: Prefs) => {
      setPrefsState(p);
      try {
        await api.savePrefs(p);
      } catch (e) {
        toast("error", `설정 저장 실패: ${errorText(e)}`);
      }
    },
    [toast],
  );

  const addProject = useCallback(
    async (path: string) => {
      try {
        const st = await api.addProject(path);
        setProjects(st.projects);
        toast("ok", "폴더를 등록했습니다");
        refresh();
      } catch (e) {
        toast("error", errorText(e));
      }
    },
    [toast, refresh],
  );

  const removeProject = useCallback(
    async (path: string) => {
      try {
        const st = await api.removeProject(path);
        setProjects(st.projects);
        setPrefsState(st.prefs);
        refresh();
      } catch (e) {
        toast("error", errorText(e));
      }
    },
    [toast, refresh],
  );

  const setFolder = useCallback(
    async (pluginId: string, projectPath: string, scope: "project" | "local", value: boolean | null) => {
      try {
        await api.setFolderEnabled(pluginId, projectPath, scope, value);
      } catch (e) {
        toast("error", errorText(e));
      }
      refresh();
    },
    [toast, refresh],
  );

  const setGroups = useCallback(
    async (g: Group[]) => {
      setGroupsState(g);
      try {
        await api.saveGroups(g);
      } catch (e) {
        toast("error", `폴더 저장 실패: ${errorText(e)}`);
      }
    },
    [toast],
  );

  return (
    <Ctx.Provider
      value={{ snap, loading, loadError, groups, toasts, busy, refresh, toast, dismissToast, toggle, toggleMany, runFix, uninstall, update, setGroups, withBusy, catalog, catalogLoading, catalogError, refreshCatalog, projects, prefs, setPrefs, addProject, removeProject, setFolder }}
    >
      {children}
    </Ctx.Provider>
  );
}
