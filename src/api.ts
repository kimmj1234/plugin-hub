import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AiStatus, Catalog, CliResult, Group, Guide, HubState, InstallScope, Prefs, ProjectFolder, Snapshot, Surface } from "./types";

export const api = {
  scan: () => invoke<Snapshot>("scan"),
  setEnabled: (id: string, enabled: boolean, scope?: string | null, projectPath?: string | null) =>
    invoke<void>("set_enabled", { id, enabled, scope: scope ?? null, projectPath: projectPath ?? null }),
  setFolderEnabled: (id: string, projectPath: string, scope: "project" | "local", value: boolean | null) =>
    invoke<void>("set_folder_enabled", { id, projectPath, scope, value }),
  removeSetting: (id: string) => invoke<void>("remove_setting", { id }),
  install: (id: string, opts: { acceptSha?: string; scope?: InstallScope; projectPath?: string | null } = {}) =>
    invoke<CliResult>("install_plugin", { id, acceptSha: opts.acceptSha ?? null, scope: opts.scope ?? "user", projectPath: opts.projectPath ?? null }),
  uninstall: (id: string, scope?: string | null, projectPath?: string | null) =>
    invoke<CliResult>("uninstall_plugin", { id, scope: scope ?? null, projectPath: projectPath ?? null }),
  update: (id: string, scope?: string | null, projectPath?: string | null) =>
    invoke<CliResult>("update_plugin", { id, scope: scope ?? null, projectPath: projectPath ?? null }),
  addMarketplace: (source: string) => invoke<CliResult>("add_marketplace", { source }),
  catalog: (refresh = false) => invoke<Catalog>("get_catalog", { refresh }),
  readme: (id: string, surface: Surface) =>
    invoke<string | null>("read_readme", { id, surface }),
  updateMarketplaces: () => invoke<string>("update_marketplaces"),
  aiStatus: () => invoke<AiStatus>("ai_status"),
  openLogin: () => invoke<void>("open_login"),
  openInClaudeApp: (kind: "plugin" | "plugins" | "directory" | "chat" | "add-marketplace", value?: string | null, plugin?: string | null) =>
    invoke<void>("open_in_claude_app", { kind, value: value ?? null, plugin: plugin ?? null }),
  installInClaudeApp: (name: string, sourceUrl: string | null) => invoke<"added" | "already">("install_in_claude_app", { name, repo: sourceUrl }),
  openAccessibilitySettings: () => invoke<void>("open_accessibility_settings"),
  getGuide: (id: string, version: string | null) => invoke<Guide | null>("get_guide", { id, version }),
  generateGuide: (args: { id: string; surface?: Surface | null; version?: string | null; name?: string | null; description?: string | null }) =>
    invoke<Guide>("generate_guide", {
      id: args.id,
      surface: args.surface ?? null,
      version: args.version ?? null,
      name: args.name ?? null,
      description: args.description ?? null,
    }),
  getState: () => invoke<HubState>("get_state"),
  saveGroups: (groups: Group[]) => invoke<void>("save_groups", { groups }),
  savePrefs: (prefs: Prefs) => invoke<void>("save_prefs", { prefs }),
  addProject: (path: string) => invoke<HubState>("add_project", { path }),
  removeProject: (path: string) => invoke<HubState>("remove_project", { path }),
  suggestProjects: () => invoke<ProjectFolder[]>("suggest_projects"),
  pickFolder: async (): Promise<string | null> => {
    const r = await openDialog({ directory: true, multiple: false, title: "플러그인을 적용할 작업 폴더 선택" });
    return typeof r === "string" ? r : null;
  },
};

export function cliMessage(r: CliResult): string {
  const text = (r.ok ? r.stdout : r.stderr || r.stdout).trim();
  const lines = text.split("\n").filter(Boolean);
  for (const l of lines) {
    try {
      const v = JSON.parse(l);
      if (typeof v === "object" && v) {
        const msg = v.message ?? v.error ?? v.status;
        if (typeof msg === "string") return msg;
      }
    } catch {
    }
  }
  return lines.slice(-3).join("\n") || (r.ok ? "완료" : `실패 (코드 ${r.code ?? "?"})`);
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
