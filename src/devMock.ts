import type { Catalog, CatalogEntry, Component, Diagnostic, Guide, HubState, Plugin, ProjectState, Snapshot } from "./types";

const comp = (name: string, description: string, extra: Partial<Component> = {}): Component => ({
  name,
  description,
  argumentHint: null,
  userInvocable: true,
  modelInvocable: true,
  examples: [],
  ...extra,
});

function plugin(p: Partial<Plugin> & Pick<Plugin, "id">): Plugin {
  const [name, marketplace] = p.id.split("@");
  return {
    name,
    displayName: name,
    marketplace,
    surface: "cli",
    enabled: true,
    installed: true,
    version: "1.0.0",
    latestVersion: null,
    scope: "user",
    projectPath: null,
    installPath: `~/.claude/plugins/cache/${marketplace}/${name}`,
    pathExists: true,
    manifestOk: true,
    description: "",
    author: null,
    homepage: null,
    repository: null,
    components: { skills: [], commands: [], agents: [], hooks: [], mcpServers: [] },
    toggleable: true,
    appRef: null,
    ...p,
  };
}

const plugins: Plugin[] = [
  plugin({
    id: "superpowers@anthropic-plugin-directory",
    version: "7.0.2",
    description: "Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques",
    author: "obra",
    repository: "https://github.com/obra/superpowers",
    components: {
      skills: [
        comp("test-driven-development", "기능을 구현하기 전에 실패하는 테스트부터 작성할 때 사용", { examples: ["로그인 기능을 TDD로 만들어줘", "테스트 먼저 써줘"] }),
        comp("systematic-debugging", "버그 원인을 추측하지 않고 단계적으로 좁혀 갈 때 사용"),
        comp("brainstorming", "구현 전에 요구사항과 설계를 정리할 때 사용", { argumentHint: "<아이디어>" }),
        comp("using-superpowers", "다른 스킬을 언제 쓸지 판단하는 내부 스킬", { userInvocable: false }),
      ],
      commands: [],
      agents: [comp("code-reviewer", "변경 사항을 리뷰하는 에이전트")],
      hooks: ["SessionStart"],
      mcpServers: [],
    },
  }),
  plugin({
    id: "frontend-design@claude-plugins-official",
    version: "1.1.1",
    description: "Frontend design skill for UI/UX implementation",
    components: { skills: [comp("frontend-design", "웹 화면을 만들거나 다듬을 때 사용")], commands: [], agents: [], hooks: [], mcpServers: [] },
  }),
  plugin({
    id: "commit-helper@team-tools",
    version: "0.4.0",
    latestVersion: "0.6.0",
    description: "커밋 메시지와 PR 설명을 프로젝트 규칙에 맞게 작성",
    components: {
      skills: [comp("deploy", "스테이징에 배포", { argumentHint: "<환경>", modelInvocable: false })],
      commands: [comp("commit", "변경 사항으로 커밋 메시지 작성", { argumentHint: "[메시지]" }), comp("pr", "현재 브랜치로 PR 설명 작성", { argumentHint: "<base 브랜치>" })],
      agents: [],
      hooks: [],
      mcpServers: [],
    },
  }),
  plugin({
    id: "deploy-kit@team-tools",
    enabled: false,
    version: "2.0.0",
    description: "배포 파이프라인 스킬 모음",
    components: { skills: [comp("deploy", "프로덕션 배포")], commands: [], agents: [], hooks: [], mcpServers: ["deploy-api"] },
  }),
  plugin({ id: "data@knowledge-work-plugins", enabled: false, version: "1.1.0", description: "Write SQL, explore datasets, and generate insights faster." }),
  plugin({ id: "old-linter@legacy-market", installed: false, installPath: null, pathExists: false, manifestOk: false, version: null }),
  plugin({ id: "design@knowledge-work-plugins", surface: "desktop", appRef: "plugin_01MockAppRef", toggleable: false, scope: null, version: "1.2.0", description: "Accelerate design workflows — critique, design system management, UX writing." }),
  plugin({ id: "engineering@knowledge-work-plugins", surface: "desktop", appRef: "plugin_01MockAppRef", toggleable: false, scope: null, version: "1.2.0", description: "Streamline engineering workflows — standups, code review, architecture decisions." }),
  plugin({ id: "frontend-design@anthropic-plugin-directory", surface: "desktop", appRef: "plugin_01MockAppRef", toggleable: false, scope: null, version: "1.1.1", description: "Frontend design skill for UI/UX implementation" }),
];

function diagnostics(): Diagnostic[] {
  const d: Diagnostic[] = [];
  const old = plugins.find((p) => p.id === "old-linter@legacy-market");
  if (old?.enabled)
    d.push({ id: "dangling:old-linter@legacy-market", severity: "error", pluginId: old.id, title: "old-linter: 켜져 있지만 설치되어 있지 않습니다", detail: "settings.json의 enabledPlugins에만 남아 있는 항목입니다.", fix: { kind: "remove-setting", label: "설정에서 항목 제거" } });
  const on = (id: string) => plugins.find((p) => p.id === id)?.enabled;
  if (on("commit-helper@team-tools") && on("deploy-kit@team-tools"))
    d.push({ id: "skill-clash:deploy", severity: "warning", pluginId: null, title: "스킬 이름 'deploy'이 여러 플러그인에 있습니다", detail: "commit-helper, deploy-kit\n'/플러그인:deploy'처럼 플러그인 이름을 붙여 부르거나 하나를 끄세요.", fix: null });
  d.push({ id: "update:commit-helper@team-tools", severity: "info", pluginId: "commit-helper@team-tools", title: "commit-helper: 새 버전 0.6.0 사용 가능 (현재 0.4.0)", detail: "마켓플레이스에 더 새로운 버전이 있습니다.", fix: { kind: "update", label: "업데이트" } });
  if (on("superpowers@anthropic-plugin-directory"))
    d.push({ id: "hooks:superpowers", severity: "info", pluginId: "superpowers@anthropic-plugin-directory", title: "superpowers: 자동 실행 훅이 있습니다 (SessionStart)", detail: "세션 시작 시 스크립트를 자동으로 실행합니다. 신뢰할 수 있는 출처인지 확인하세요.", fix: null });
  if (on("frontend-design@claude-plugins-official"))
    d.push({ id: "both-surfaces:frontend-design", severity: "info", pluginId: "frontend-design@claude-plugins-official", title: "frontend-design: Claude 앱과 터미널 양쪽에서 켜져 있습니다", detail: "한쪽에서 쓰는 것을 권장합니다.", fix: null });
  const rank = { error: 0, warning: 1, info: 2 };
  return d.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function snapshot(): Snapshot {
  return {
    env: {
      os: "macos",
      claudeHome: "~/.claude",
      claudeHomeExists: true,
      terminalCli: { path: "~/.local/bin/claude", version: "2.1.325", kind: "terminal" },
      desktopInstalled: true,
      desktopBundledVersions: ["2.1.325"],
      activeCli: { path: "~/.local/bin/claude", version: "2.1.325", kind: "terminal" },
    },
    plugins: structuredClone(plugins),
    marketplaces: [
      { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", installLocation: null, pluginCount: 48 },
      { name: "team-tools", source: "my-team/claude-tools", installLocation: null, pluginCount: 6 },
    ],
    diagnostics: diagnostics(),
    projects: hub.projects.map((f) => ({
      ...f,
      exists: true,
      isGitRepo: f.name !== "개인-메모",
      shared: folderSettings[f.path]?.shared ?? {},
      local: folderSettings[f.path]?.local ?? {},
      sharedError: null,
      localError: null,
    })) as ProjectState[],
    settingsError: null,
    scannedAt: Date.now(),
  };
}

const catalogEntries: CatalogEntry[] = [
  ["superpowers", "Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques", "7.0.2"],
  ["frontend-design", "Frontend design skill for UI/UX implementation", "1.1.1"],
  ["code-review", "Automated pull request review with multiple specialist agents", "1.3.0"],
  ["security-guidance", "Warns about risky patterns while editing code", "1.0.4"],
  ["playwright", "Browser automation and end-to-end testing", "0.9.1"],
  ["commit-commands", "Git commit, push and PR workflows", "1.2.0"],
  ["feature-dev", "Guided feature development with exploration and architecture agents", "1.0.0"],
  ["data", "Write SQL, explore datasets, and generate insights faster", "1.1.0"],
  ["design", "Accelerate design workflows — critique, design systems, UX writing", "1.2.0"],
  ["remotion", "Remotion video creation skills — best practices, animations, audio", "1.0.2"],
  ["mattpocock-skills", "Skills for TypeScript developers", "1.0.0", "https://github.com/mattpocock/skills"],
  ["humanizer", "Make AI-written text sound natural", "2.1.0", "https://github.com/blader/humanizer"],
].map(([name, description, version, url], i) => ({
  pluginId: `${name}@anthropic-plugin-directory`,
  name,
  description,
  marketplace: "anthropic-plugin-directory",
  version,
  sourceUrl: url ?? (name === "superpowers" ? "https://github.com/obra/superpowers" : "https://github.com/anthropics/claude-plugins-official"),
  installable: true, directoryId: null, appName: null, surfaces: ["claude_code", "cowork", "claude_ai"],
  isNew: i === 11,
  updated: i === 4,
  firstSeen: i === 11 ? Date.now() : 0,
}));

const guides: Record<string, Guide> = {};

const folderSettings: Record<string, { shared: Record<string, boolean>; local: Record<string, boolean> }> = {
  "~/dev/shop-web": { shared: { "frontend-design@claude-plugins-official": true, "deploy-kit@team-tools": true }, local: { "superpowers@anthropic-plugin-directory": false } },
};

let hub: HubState = {
  groups: [],
  projects: [
    { path: "~/dev/shop-web", name: "shop-web" },
    { path: "~/dev/api-server", name: "api-server" },
  ],
  prefs: { defaultInstallScope: "user", defaultInstallProject: null, remoteRefreshMinutes: 30 },
};

let groups = { groups: [{ id: "g1", name: "매일 쓰는 것", pluginIds: ["superpowers@anthropic-plugin-directory", "frontend-design@claude-plugins-official"] }, { id: "g2", name: "팀 배포", pluginIds: ["commit-helper@team-tools", "deploy-kit@team-tools"] }] };

const ok = (stdout: string) => ({ ok: true, code: 0, stdout, stderr: "", needsAccept: null });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function invoke(cmd: string, args: Record<string, any> = {}): Promise<unknown> {
  switch (cmd) {
    case "scan":
      return snapshot();
    case "set_enabled": {
      const p = plugins.find((x) => x.id === args.id && x.surface === "cli");
      if (p) p.enabled = args.enabled;
      return null;
    }
    case "remove_setting": {
      const i = plugins.findIndex((x) => x.id === args.id && !x.installed);
      if (i >= 0) plugins.splice(i, 1);
      return null;
    }
    case "install_plugin": {
      await wait(1200);
      const e = catalogEntries.find((x) => x.pluginId === args.id);
      if (e && !plugins.some((p) => p.id === e.pluginId)) plugins.push(plugin({ id: e.pluginId, version: e.version, description: e.description }));
      return ok(`Installed ${args.id}`);
    }
    case "uninstall_plugin": {
      const i = plugins.findIndex((x) => x.id === args.id && x.surface === "cli");
      if (i >= 0) plugins.splice(i, 1);
      return ok(`Uninstalled ${args.id}`);
    }
    case "update_plugin": {
      await wait(800);
      const p = plugins.find((x) => x.id === args.id);
      if (p && p.latestVersion) { p.version = p.latestVersion; p.latestVersion = null; }
      return ok(`Updated ${args.id}`);
    }
    case "add_marketplace":
      await wait(800);
      return ok(`Added marketplace ${args.source}`);
    case "install_in_claude_app":
      await wait(1500);
      return "added";
    case "open_accessibility_settings":
      return null;
    case "open_in_claude_app":
      console.info("[mock] Claude 앱 열기", args);
      return null;
    case "get_catalog":
      await wait(300);
      return { entries: catalogEntries, origin: "cli", fetchedAt: Date.now(), newCount: 1, updatedCount: 1, firstRun: false } satisfies Catalog;
    case "update_marketplaces":
      await wait(500);
      return "updated";
    case "ai_status":
      return { cliFound: true, loggedIn: true, detail: "로그인됨" };
    case "open_login":
      return null;
    case "get_guide":
      return guides[args.id] ?? null;
    case "generate_guide": {
      await wait(1500);
      const g: Guide = {
        summary: `${args.id.split("@")[0]}는 (미리보기 예시) 개발 흐름을 정리해 주는 플러그인입니다. 테스트 작성과 디버깅을 단계별로 안내합니다.`,
        useCases: ["새 기능을 만들기 전에 테스트부터 쓰고 싶을 때", "원인을 모르는 버그를 체계적으로 좁혀 갈 때"],
        commands: [{ command: "/superpowers:brainstorming <아이디어>", description: "구현 전에 요구사항을 정리합니다", usage: "아이디어를 한 줄로 적으면 질문을 이어 가며 설계를 다듬습니다", example: "/superpowers:brainstorming 사내 공지 앱" }],
        tips: ["명령을 치지 않아도 '테스트 먼저 써줘'처럼 말하면 자동으로 스킬이 쓰입니다"],
        cautions: ["세션 시작 시 훅이 자동 실행됩니다"],
        generatedAt: Date.now(),
        version: args.version ?? null,
      };
      guides[args.id] = g;
      return g;
    }
    case "read_readme":
      return "# 사용 예시\n\n이 README는 **미리보기 모드**의 예시입니다.\n\n- 설치 후 새 세션을 시작하세요\n- `/plugin:skill` 형식으로 직접 부를 수 있습니다\n\n```bash\nclaude plugin list\n```";
    case "get_state":
      return { ...hub, groups: groups.groups };
    case "save_groups":
      groups = { groups: args.groups };
      return null;
    case "save_prefs":
      hub = { ...hub, prefs: args.prefs };
      return null;
    case "add_project": {
      if (!hub.projects.some((p) => p.path === args.path)) hub.projects.push({ path: args.path, name: String(args.path).split("/").pop() ?? args.path });
      return { ...hub, groups: groups.groups };
    }
    case "remove_project":
      hub.projects = hub.projects.filter((p) => p.path !== args.path);
      if (hub.prefs.defaultInstallProject === args.path) hub.prefs = { ...hub.prefs, defaultInstallProject: null, defaultInstallScope: "user" };
      return { ...hub, groups: groups.groups };
    case "suggest_projects":
      return [{ path: "~/dev/blog", name: "blog" }, { path: "~/Documents/개인-메모", name: "개인-메모" }];
    case "set_folder_enabled": {
      const f = (folderSettings[args.projectPath] ??= { shared: {}, local: {} });
      const m = args.scope === "local" ? f.local : f.shared;
      if (args.value === null) delete m[args.id];
      else m[args.id] = args.value;
      return null;
    }
    case "plugin:dialog|open":
      return "~/dev/new-project";
    case "plugin:event|listen":
      return 1;
    case "plugin:event|unlisten":
      return null;
    case "plugin:opener|open_url":
      window.open(args.url, "_blank");
      return null;
    default:
      throw `미리보기 모드에서 지원하지 않는 명령: ${cmd}`;
  }
}

let cb = 0;
(window as any).__TAURI_INTERNALS__ = {
  invoke,
  transformCallback: () => ++cb,
  unregisterCallback: () => {},
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
};
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
console.info("[Plugin Hub] 브라우저 미리보기 모드: 가짜 데이터로 동작합니다.");
