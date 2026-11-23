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
  installedAt?: string | null;
  /** 폴더 범위로 설치했는데 그 폴더가 삭제됨: 켜기·끄기·업데이트 불가, 삭제(기록 정리)만 가능 */
  folderMissing?: boolean;
  /** 같은 플러그인을 다른 범위에도 설치한 기록 (목록에는 대표 하나만 보인다) */
  otherInstalls?: OtherInstall[];
}

export interface OtherInstall {
  scope: string;
  projectPath: string | null;
  version: string | null;
  enabled: boolean;
  folderMissing: boolean;
}

export interface Marketplace {
  name: string;
  source: string;
  installLocation: string | null;
  pluginCount: number;
}

export interface Fix {
  kind: "remove-setting" | "reinstall" | "update" | "disable" | "cleanup-folder";
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
  /** 설정 파일 실시간 감시가 동작 중인지 */
  watcherOk?: boolean;
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
  appName: string | null;
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
  /** 공식 명령으로 목록을 받지 못해 로컬 캐시를 보여 줄 때, 그 이유 */
  fallbackReason?: string | null;
}

export interface GuideCommand {
  command: string;
  description: string;
  /** 이럴 때 추천: 이 명령을 쓰면 좋은 상황 (예전에 만든 가이드에는 없음) */
  when?: string;
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
  /** 성공했지만 알려야 할 내용 */
  warning?: string | null;
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
  autoUpdatePlugins: boolean;
  launchAtLogin: boolean;
  onboardingDone: boolean;
  privacyAck: number;
  usageConsent: boolean;
  appUpdate: "auto" | "notify" | "off";
}

export interface Permissions {
  os: string;
  accessibility: boolean | null;
  cli: CliInfo | null;
  desktopInstalled: boolean;
  claudeHomeExists: boolean;
}

export interface HubState {
  groups: Group[];
  projects: ProjectFolder[];
  prefs: Prefs;
}

export interface PluginUsage {
  plugin: string;
  count: number;
  lastUsed: string | null;
}

export interface UsageReport {
  days: number;
  sessions: number;
  plugins: PluginUsage[];
}
