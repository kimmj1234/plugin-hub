import { invoke } from "@tauri-apps/api/core";
import type { AiStatus, Catalog, CliResult, Guide, HubState, Snapshot, Surface } from "./types";

export const api = {
  scan: () => invoke<Snapshot>("scan"),
  setEnabled: (id: string, enabled: boolean, scope?: string | null) =>
    invoke<void>("set_enabled", { id, enabled, scope: scope ?? null }),
  removeSetting: (id: string) => invoke<void>("remove_setting", { id }),
  install: (id: string, acceptSha?: string) =>
    invoke<CliResult>("install_plugin", { id, acceptSha: acceptSha ?? null }),
  uninstall: (id: string, scope?: string | null) =>
    invoke<CliResult>("uninstall_plugin", { id, scope: scope ?? null }),
  update: (id: string, scope?: string | null) =>
    invoke<CliResult>("update_plugin", { id, scope: scope ?? null }),
  addMarketplace: (source: string) => invoke<CliResult>("add_marketplace", { source }),
  catalog: (refresh = false) => invoke<Catalog>("get_catalog", { refresh }),
  readme: (id: string, surface: Surface) =>
    invoke<string | null>("read_readme", { id, surface }),
  updateMarketplaces: () => invoke<string>("update_marketplaces"),
  aiStatus: () => invoke<AiStatus>("ai_status"),
  openLogin: () => invoke<void>("open_login"),
  getGuide: (id: string, version: string | null) => invoke<Guide | null>("get_guide", { id, version }),
  generateGuide: (args: { id: string; surface?: Surface | null; version?: string | null; name?: string | null; description?: string | null }) =>
    invoke<Guide>("generate_guide", {
      id: args.id,
      surface: args.surface ?? null,
      version: args.version ?? null,
      name: args.name ?? null,
      description: args.description ?? null,
    }),
  getGroups: () => invoke<HubState>("get_groups"),
  saveGroups: (state: HubState) => invoke<void>("save_groups", { state }),
};

/** CLI 결과를 사람이 읽을 메시지로 */
export function cliMessage(r: CliResult): string {
  const text = (r.ok ? r.stdout : r.stderr || r.stdout).trim();
  const lines = text.split("\n").filter(Boolean);
  // --json 출력이면 한 줄 JSON에서 message/error를 꺼낸다
  for (const l of lines) {
    try {
      const v = JSON.parse(l);
      if (typeof v === "object" && v) {
        const msg = v.message ?? v.error ?? v.status;
        if (typeof msg === "string") return msg;
      }
    } catch {
      /* 일반 텍스트 */
    }
  }
  return lines.slice(-3).join("\n") || (r.ok ? "완료" : `실패 (코드 ${r.code ?? "?"})`);
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
