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
  argumentHint: string | null;
  userInvocable: boolean;
  modelInvocable: boolean;
  examples: string[];
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
  projectPath: string | null;
  installPath: string | null;
  pathExists: boolean;
  manifestOk: boolean;
  description: string;
  author: string | null;
  homepage: string | null;
  repository: string | null;
  components: Components;
  toggleable: boolean;
  appRef: string | null;
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
  projects: ProjectState[];
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
  directoryId: string | null;
  surfaces: string[];
  isNew: boolean;
  updated: boolean;
  firstSeen: number;
}

export interface Catalog {
  entries: CatalogEntry[];
  origin: "cli" | "local-cache";
  fetchedAt: number;
  newCount: number;
  updatedCount: number;
  firstRun: boolean;
}

export interface GuideCommand {
  command: string;
  description: string;
  usage: string;
  example: string;
}

export interface Guide {
  summary: string;
  useCases: string[];
  commands: GuideCommand[];
  tips: string[];
  cautions: string[];
  generatedAt: number;
  version: string | null;
}

export interface AiStatus {
  cliFound: boolean;
  loggedIn: boolean;
  detail: string;
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

export interface ProjectFolder {
  path: string;
  name: string;
}

export interface ProjectState extends ProjectFolder {
  exists: boolean;
  isGitRepo: boolean;
  shared: Record<string, boolean>;
  local: Record<string, boolean>;
  sharedError: string | null;
  localError: string | null;
}

export type InstallScope = "user" | "project" | "local";

export interface Prefs {
  defaultInstallScope: InstallScope;
  defaultInstallProject: string | null;
  remoteRefreshMinutes: number;
}

export interface HubState {
  groups: Group[];
  projects: ProjectFolder[];
  prefs: Prefs;
}
