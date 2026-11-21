import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, cliMessage, errorText } from "./api";
import type { Catalog, Diagnostic, Group, InstallScope, Plugin, PluginUsage, Prefs, ProjectFolder, Snapshot } from "./types";

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
  refreshCatalog: (remote: boolean) => Promise<void>;
  projects: ProjectFolder[];
  prefs: Prefs;
  setPrefs: (p: Prefs) => Promise<void>;
  addProject: (path: string) => Promise<boolean>;
  removeProject: (path: string) => Promise<void>;
  setFolder: (pluginId: string, projectPath: string, scope: "project" | "local", value: boolean | null) => Promise<void>;
  usage: Record<string, PluginUsage> | null;
  usageDays: number;
  usageSessions: number;
  refreshUsage: () => Promise<void>;
}

export const USAGE_DAYS = 30;

const CONFIRM_MS = 3000;
const INSTALLING_RECHECK_MS = 5000;

const DEFAULT_PREFS: Prefs = { defaultInstallScope: "user", defaultInstallProject: null, remoteRefreshMinutes: 30, autoUpdatePlugins: false, launchAtLogin: false };



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
  const pendingDiag = useRef<Map<string, number>>(new Map());
  const recheckTimer = useRef<number | undefined>(undefined);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const seenApp = useRef<Set<string> | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const flagged = useRef<Set<string> | null>(null);
  const catalogBusy = useRef(false);
  const [projects, setProjects] = useState<ProjectFolder[]>([]);
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const toastId = useRef(0);
  const scanSeq = useRef(0);
  const catalogAgain = useRef(false);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 5000);
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const refresh = useCallback(async () => {
    const seq = ++scanSeq.current;
    try {
      const s = await api.scan();
      if (seq !== scanSeq.current) return;
      // 새 문제는 바로 알리지 않고 몇 초 뒤 다시 검사해서도 남아 있을 때만 알린다.
      // (설치·삭제 도중 파일이 차례로 바뀌는 순간에 생기는 일시적인 불일치를 걸러낸다)
      const important = s.diagnostics.filter((d) => d.severity !== "info");
      const now = Date.now();
      const confirmed = new Set<string>();
      let recheck = false;
      for (const d of important) {
        if (!seenDiag.current || seenDiag.current.has(d.id)) {
          confirmed.add(d.id);
          continue;
        }
        const first = pendingDiag.current.get(d.id);
        if (first === undefined) {
          pendingDiag.current.set(d.id, now);
          recheck = true;
        } else if (now - first >= CONFIRM_MS) {
          toast(d.severity === "error" ? "error" : "warning", `새로 감지됨: ${d.title}`);
          confirmed.add(d.id);
          pendingDiag.current.delete(d.id);
        } else {
          recheck = true;
        }
      }
      const present = new Set(important.map((d) => d.id));
      for (const id of [...pendingDiag.current.keys()]) if (!present.has(id)) pendingDiag.current.delete(id);
      seenDiag.current = confirmed;
      const installing = s.diagnostics.some((d) => d.id.startsWith("installing:"));
      if (recheck || installing) {
        clearTimeout(recheckTimer.current);
        recheckTimer.current = window.setTimeout(() => refreshRef.current(), installing ? INSTALLING_RECHECK_MS : CONFIRM_MS + 500);
      }
      const appNow = s.plugins.filter((p) => p.surface === "desktop");
      if (seenApp.current) {
        for (const p of appNow) if (!seenApp.current.has(p.id)) toast("ok", `Claude 앱에 설치됨: ${p.displayName}`);
      }
      seenApp.current = new Set(appNow.map((p) => p.id));
      setSnap(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);
  refreshRef.current = refresh;

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
            const done = await withBusy(d.id, "정리 중", async () => {
              await api.removeSetting(d.pluginId!);
              return true;
            });
            if (done) toast("ok", "설정에서 항목을 제거했습니다");
          }
          break;
        case "reinstall":
          if (d.pluginId) {
            const r = await withBusy(d.id, "설치 중", () => api.install(d.pluginId!, { scope: (p?.scope as InstallScope | null) ?? "user", projectPath: p?.projectPath }));
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
      if (catalogBusy.current) {
        catalogAgain.current = true;
        return;
      }
      catalogBusy.current = true;
      setCatalogLoading(true);
      try {
        if (remote) {
          try {
            await api.updateMarketplaces();
          } catch (e) {
            console.warn(e);
          }
        }
        const c = await api.catalog(true);
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
        if (catalogAgain.current) {
          catalogAgain.current = false;
          setTimeout(() => refreshCatalog(false), 0);
        }
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

  useEffect(() => {
    if (!prefs.remoteRefreshMinutes) return;
    const timer = setInterval(() => refreshCatalog(true), prefs.remoteRefreshMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshCatalog, prefs.remoteRefreshMinutes]);

  // 자동 업데이트: 새 버전이 보이면 하나씩 업데이트한다. 같은 버전은 한 번만 시도해 실패가 반복되지 않게 한다.
  const autoTried = useRef<Set<string>>(new Set());
  const autoRunning = useRef(false);
  useEffect(() => {
    if (!prefs.autoUpdatePlugins || !snap || autoRunning.current) return;
    const due = snap.plugins.filter(
      (p) => p.surface === "cli" && p.version && p.latestVersion && p.latestVersion !== p.version && !autoTried.current.has(`${p.id}@${p.latestVersion}`),
    );
    if (!due.length) return;
    autoRunning.current = true;
    (async () => {
      let ok = 0;
      for (const p of due) {
        autoTried.current.add(`${p.id}@${p.latestVersion}`);
        const r = await withBusy(p.id, "자동 업데이트 중", () => api.update(p.id, p.scope, p.projectPath));
        if (r?.ok) ok++;
        else if (r) reportCli(`${p.displayName} 자동 업데이트`, r);
      }
      autoRunning.current = false;
      if (ok) toast("ok", `플러그인 ${ok}개를 자동으로 업데이트했습니다 · 새 Claude Code 세션부터 적용됩니다`);
      refresh();
    })();
  }, [snap, prefs.autoUpdatePlugins, withBusy, reportCli, toast, refresh]);

  // 자동 업데이트를 켜 두었으면 시작할 때 한 번 원본을 확인한다.
  const startupChecked = useRef(false);
  useEffect(() => {
    if (prefs.autoUpdatePlugins && !startupChecked.current) {
      startupChecked.current = true;
      refreshCatalog(true);
    }
  }, [prefs.autoUpdatePlugins, refreshCatalog]);

  // 사용 분석: 대화 기록에서 최근 30일 동안 플러그인을 몇 번 썼는지 (터미널·Code 탭 플러그인만)
  const [usage, setUsage] = useState<Record<string, PluginUsage> | null>(null);
  const [usageSessions, setUsageSessions] = useState(0);
  const cliNames = snap ? [...new Set(snap.plugins.filter((p) => p.surface === "cli").flatMap((p) => [p.name, p.displayName]))].sort().join("\n") : "";
  const refreshUsage = useCallback(async () => {
    if (!cliNames) return;
    try {
      const r = await api.usage(cliNames.split("\n"), USAGE_DAYS);
      setUsage(Object.fromEntries(r.plugins.map((u) => [u.plugin, u])));
      setUsageSessions(r.sessions);
    } catch (e) {
      console.warn("usage", e);
    }
  }, [cliNames]);
  useEffect(() => {
    refreshUsage();
    const timer = setInterval(refreshUsage, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshUsage]);

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
        return true;
      } catch (e) {
        toast("error", errorText(e));
        return false;
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
      value={{ snap, loading, loadError, groups, toasts, busy, refresh, toast, dismissToast, toggle, toggleMany, runFix, uninstall, update, setGroups, withBusy, catalog, catalogLoading, catalogError, refreshCatalog, projects, prefs, setPrefs, addProject, removeProject, setFolder, usage, usageDays: USAGE_DAYS, usageSessions, refreshUsage }}
    >
      {children}
    </Ctx.Provider>
  );
}
