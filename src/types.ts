export interface CliInfo {
  path: string;
  version: string | null;
  kind: "terminal" | "desktop-bundled";
}

export interface EnvInfo {
  os: string;
  claudeHome: string;
  claudeHomeExists: boolean;
  terminalCli: CliInfo | null;
  desktopInstalled: boolean;
  desktopBundledVersions: string[];
  activeCli: CliInfo | null;
}

export interface Component {
  name: string;
  description: string;
}

export interface Components {
  skills: Component[];
  commands: Component[];
  agents: Component[];
  hooks: string[];
  mcpServers: string[];
}

export type Surface = "cli" | "desktop";

export interface Plugin {
  id: string;
  name: string;
  displayName: string;
  marketplace: string;
  surface: Surface;
  enabled: boolean;
  installed: boolean;
  version: string | null;
  latestVersion: string | null;
  scope: string | null;
  installPath: string | null;
  pathExists: boolean;
  manifestOk: boolean;
  description: string;
  author: string | null;
  homepage: string | null;
  repository: string | null;
  components: Components;
  toggleable: boolean;
}

export interface Marketplace {
  name: string;
  source: string;
  installLocation: string | null;
  pluginCount: number;
}

export interface Fix {
  kind: "remove-setting" | "reinstall" | "update" | "disable";
  label: string;
}

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  id: string;
  severity: Severity;
  pluginId: string | null;
  title: string;
  detail: string;
  fix: Fix | null;
}

export interface Snapshot {
  env: EnvInfo;
  plugins: Plugin[];
  marketplaces: Marketplace[];
  diagnostics: Diagnostic[];
  settingsError: string | null;
  scannedAt: number;
}

export interface CatalogEntry {
  pluginId: string;
  name: string;
  description: string;
  marketplace: string;
  version: string | null;
  sourceUrl: string | null;
  installable: boolean;
}

export interface Catalog {
  entries: CatalogEntry[];
  origin: "cli" | "local-cache";
  fetchedAt: number;
}

export interface AcceptPrompt {
  sha256: string;
  detail: string;
}

export interface CliResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  needsAccept: AcceptPrompt | null;
}

export interface Group {
  id: string;
  name: string;
  pluginIds: string[];
}

export interface HubState {
  groups: Group[];
}
