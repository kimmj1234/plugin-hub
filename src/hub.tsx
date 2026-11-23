import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, cliMessage, errorText } from "./api";
import type { Catalog, Diagnostic, Group, InstallScope, OtherInstall, Permissions, Plugin, PluginUsage, Prefs, ProjectFolder, Snapshot } from "./types";
import { scopeLabel } from "./scope";

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
  uninstall: (p: Plugin, at?: OtherInstall) => Promise<void>;
  update: (p: Plugin) => Promise<void>;
  setGroups: (groups: Group[]) => Promise<void>;
  withBusy: <T>(key: string, label: string, fn: () => Promise<T>) => Promise<T | undefined>;
  catalog: Catalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  refreshCatalog: (remote: boolean) => Promise<void>;
  projects: ProjectFolder[];
  prefs: Prefs;
  setPrefs: (p: Prefs) => Promise<boolean>;
  addProject: (path: string) => Promise<boolean>;
  removeProject: (path: string) => Promise<void>;
  setFolder: (pluginId: string, projectPath: string, scope: "project" | "local", value: boolean | null) => Promise<void>;
  prefsLoaded: boolean;
  perm: Permissions | null;
  refreshPerm: () => Promise<Permissions | null>;
  usage: Record<string, PluginUsage> | null;
  usageDays: number;
  usageSessions: number;
  refreshUsage: () => Promise<void>;
  /** 앱 설정(hub-state.json)을 읽지 못했을 때 */
  stateError: string | null;
  reloadState: () => void;
  /** 마지막 원본(마켓플레이스) 확인이 실패한 이유 */
  remoteError: string | null;
}

export const USAGE_DAYS = 30;
/// 개인정보 안내문 버전. 안내 내용이 바뀌면 올려서 다시 동의를 받는다.
export const PRIVACY_VERSION = 1;

const CONFIRM_MS = 3000;
const INSTALLING_RECHECK_MS = 5000;

const DEFAULT_PREFS: Prefs = { defaultInstallScope: "user", defaultInstallProject: null, remoteRefreshMinutes: 30, autoUpdatePlugins: false, launchAtLogin: false, onboardingDone: false, privacyAck: 0, usageConsent: false, appUpdate: "auto" };



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
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const prefsRef = useRef<Prefs>(DEFAULT_PREFS);
  prefsRef.current = prefs;
  const busyRef = useRef<Record<string, string>>({});
  const [perm, setPerm] = useState<Permissions | null>(null);
  // 개인정보 안내에 동의하기 전에는 파일 검사·CLI 실행·네트워크 확인을 하나도 하지 않는다.
  const consented = prefsLoaded && prefs.onboardingDone && prefs.privacyAck >= PRIVACY_VERSION;
  const toastId = useRef(0);
  const scanSeq = useRef(0);
  const catalogAgain = useRef<boolean | null>(null);

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

  // 앱 설정을 읽지 못했을 때 기본값으로 넘어가면 처음 설정 화면이 다시 나오고, 거기서 저장하면
  // 등록한 폴더·묶음·동의 기록을 덮어쓴다. 그래서 실패하면 오류와 "다시 시도"를 보여 준다.
  const reloadState = useCallback(() => {
    setStateError(null);
    api
      .getState()
      .then((s) => {
        setGroupsState(s.groups);
        setProjects(s.projects);
        setPrefsState(s.prefs);
        setPrefsLoaded(true);
      })
      .catch((e) => setStateError(errorText(e)));
  }, []);
  useEffect(() => {
    reloadState();
  }, [reloadState]);

  useEffect(() => {
    if (!consented) return;
    refresh();
    const un = listen("hub://changed", () => refresh());
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      un.then((f) => f());
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, consented]);

  const withBusy = useCallback(
    async <T,>(key: string, label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy((b) => (busyRef.current = { ...b, [key]: label }));
      try {
        return await fn();
      } catch (e) {
        toast("error", errorText(e));
        return undefined;
      } finally {
        setBusy((b) => {
          const n = { ...b };
          delete n[key];
          busyRef.current = n;
          return n;
        });
      }
    },
    [toast],
  );

  const toggle = useCallback(
    async (p: Plugin, enabled: boolean) => {
      if (p.folderMissing) {
        toast("error", `${p.displayName}: 설치한 폴더가 삭제되어 켜고 끌 수 없습니다. '설치 기록 정리'로 정리하세요.`);
        return;
      }
      // 이미 진행 중인 검사 결과가 늦게 도착해 방금 바꾼 스위치를 되돌리지 않게, 그 결과는 버린다
      ++scanSeq.current;
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
      const targets = ps.filter((p) => p.toggleable && !p.folderMissing && p.enabled !== enabled);
      let done = 0;
      for (const p of targets) {
        try {
          await api.setEnabled(p.id, enabled, p.scope, p.projectPath);
          done++;
        } catch (e) {
          toast("error", `${p.displayName}: ${errorText(e)}`);
        }
      }
      const failed = targets.length - done;
      if (done) toast(failed ? "warning" : "ok", `${done}개 플러그인을 ${enabled ? "켰" : "껐"}습니다${failed ? ` · ${failed}개는 실패` : ""}`);
      refresh();
    },
    [refresh, toast],
  );

  const reportCli = useCallback(
    (label: string, r: { ok: boolean } & Parameters<typeof cliMessage>[0]) => {
      toast(r.ok ? "ok" : "error", `${label}: ${cliMessage(r)}`);
      if (r.warning) toast("warning", r.warning);
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
    async (p: Plugin, at?: OtherInstall) => {
      const scope = at ? at.scope : p.scope;
      const projectPath = at ? at.projectPath : p.projectPath;
      const r = await withBusy(p.id, "삭제 중", () => api.uninstall(p.id, scope, projectPath));
      if (r) reportCli(`${p.displayName}${at ? ` (${scopeLabel(at.scope)})` : ""} 삭제`, r);
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
        case "cleanup-folder":
          if (p) await uninstall(p);
          break;
      }
      refresh();
    },
    [snap, withBusy, toast, reportCli, update, toggle, uninstall, refresh],
  );

  const refreshCatalog = useCallback(
    async (remote: boolean) => {
      if (catalogBusy.current) {
        // 진행 중에 원본 확인 요청이 오면, 끝난 뒤 다시 할 때도 원본 확인으로 한다
        catalogAgain.current = (catalogAgain.current ?? false) || remote;
        return;
      }
      catalogBusy.current = true;
      setCatalogLoading(true);
      try {
        if (remote) {
          try {
            await api.updateMarketplaces();
            setRemoteError(null);
          } catch (e) {
            setRemoteError(errorText(e));
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
        if (catalogAgain.current !== null) {
          const again = catalogAgain.current;
          catalogAgain.current = null;
          setTimeout(() => refreshCatalog(again), 0);
        }
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!consented) return;
    refreshCatalog(false);
    const un = listen("hub://catalog-changed", () => refreshCatalog(false));
    return () => {
      un.then((f) => f());
    };
  }, [refreshCatalog, consented]);

  useEffect(() => {
    if (!consented || !prefs.remoteRefreshMinutes) return;
    const timer = setInterval(() => refreshCatalog(true), prefs.remoteRefreshMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshCatalog, prefs.remoteRefreshMinutes, consented]);

  // 자동 업데이트: 새 버전이 보이면 하나씩 업데이트한다. 같은 버전은 한 번만 시도해 실패가 반복되지 않게 한다.
  const autoTried = useRef<Set<string>>(new Set());
  const autoRunning = useRef(false);
  useEffect(() => {
    if (!prefs.autoUpdatePlugins || !snap || autoRunning.current) return;
    const due = snap.plugins.filter(
      (p) => p.surface === "cli" && !p.folderMissing && !busyRef.current[p.id] && p.version && p.latestVersion && p.latestVersion !== p.version && !autoTried.current.has(`${p.id}@${p.latestVersion}`),
    );
    if (!due.length) return;
    autoRunning.current = true;
    (async () => {
      let ok = 0;
      try {
        for (const p of due) {
          autoTried.current.add(`${p.id}@${p.latestVersion}`);
          // 사용자가 그 사이 같은 플러그인을 지우거나 업데이트하고 있으면 건너뛴다
          if (busyRef.current[p.id]) continue;
          const r = await withBusy(p.id, "자동 업데이트 중", () => api.update(p.id, p.scope, p.projectPath));
          if (r?.ok) ok++;
          else if (r) reportCli(`${p.displayName} 자동 업데이트`, r);
        }
      } finally {
        autoRunning.current = false;
      }
      if (ok) toast("ok", `플러그인 ${ok}개를 자동으로 업데이트했습니다 · 새 Claude Code 세션부터 적용됩니다`);
      refresh();
    })();
  }, [snap, prefs.autoUpdatePlugins, withBusy, reportCli, toast, refresh]);

  // 자동 업데이트를 켜 두었으면 시작할 때 한 번 원본을 확인한다.
  const startupChecked = useRef(false);
  useEffect(() => {
    if (consented && prefs.autoUpdatePlugins && !startupChecked.current) {
      startupChecked.current = true;
      refreshCatalog(true);
    }
  }, [prefs.autoUpdatePlugins, refreshCatalog, consented]);

  // 사용 분석: 대화 기록에서 최근 30일 동안 플러그인을 몇 번 썼는지 (터미널·Code 탭 플러그인만)
  const [usage, setUsage] = useState<Record<string, PluginUsage> | null>(null);
  const [usageSessions, setUsageSessions] = useState(0);
  const cliNames = snap ? [...new Set(snap.plugins.filter((p) => p.surface === "cli").flatMap((p) => [p.name, p.displayName]))].sort().join("\n") : "";
  const usageSeq = useRef(0);
  const refreshUsage = useCallback(async () => {
    const seq = ++usageSeq.current;
    if (!consented || !cliNames || !prefs.usageConsent) {
      setUsage(null);
      return;
    }
    try {
      const r = await api.usage(cliNames.split("\n"), USAGE_DAYS);
      if (seq !== usageSeq.current) return; // 더 최근 요청의 결과를 덮어쓰지 않는다
      setUsage(Object.fromEntries(r.plugins.map((u) => [u.plugin, u])));
      setUsageSessions(r.sessions);
    } catch (e) {
      console.warn("usage", e);
    }
  }, [cliNames, prefs.usageConsent, consented]);
  useEffect(() => {
    refreshUsage();
    const timer = setInterval(refreshUsage, 10 * 60 * 1000);
    return () => clearInterval(timer);
  }, [refreshUsage]);

  // 권한·준비 상태 (손쉬운 사용, Claude Code 실행 파일 등). 창으로 돌아올 때마다 다시 확인한다.
  const refreshPerm = useCallback(async () => {
    try {
      const p = await api.permissions();
      setPerm(p);
      return p;
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    if (!consented) return; // 첫 실행 설정 화면은 동의 뒤 단계에서 직접 확인한다
    refreshPerm();
    const onFocus = () => refreshPerm();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPerm, consented]);

  const setPrefs = useCallback(
    async (p: Prefs): Promise<boolean> => {
      const before = prefsRef.current;
      setPrefsState(p);
      try {
        await api.savePrefs(p);
        return true;
      } catch (e) {
        // 저장에 실패하면 화면도 되돌린다 (예: 로그인 시 실행을 켜지 못했는데 켜짐으로 보이지 않게)
        setPrefsState(before);
        toast("error", `설정 저장 실패: ${errorText(e)}`);
        return false;
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
        toast("error", `묶음 저장 실패: ${errorText(e)}`);
      }
    },
    [toast],
  );

  const value = useMemo<HubCtx>(
    () => ({ snap, loading, loadError, groups, toasts, busy, refresh, toast, dismissToast, toggle, toggleMany, runFix, uninstall, update, setGroups, withBusy, catalog, catalogLoading, catalogError, refreshCatalog, projects, prefs, setPrefs, addProject, removeProject, setFolder, prefsLoaded, perm, refreshPerm, usage, usageDays: USAGE_DAYS, usageSessions, refreshUsage, stateError, reloadState, remoteError }),
    [snap, loading, loadError, groups, toasts, busy, refresh, toast, dismissToast, toggle, toggleMany, runFix, uninstall, update, setGroups, withBusy, catalog, catalogLoading, catalogError, refreshCatalog, projects, prefs, setPrefs, addProject, removeProject, setFolder, prefsLoaded, perm, refreshPerm, usage, usageSessions, refreshUsage, stateError, reloadState, remoteError],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
    </Ctx.Provider>
  );
}
