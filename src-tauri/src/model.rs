//! 프론트엔드와 주고받는 데이터 구조.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub path: String,
    pub version: Option<String>,
    /// "terminal" | "desktop-bundled"
    pub kind: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    pub os: String,
    pub claude_home: String,
    pub claude_home_exists: bool,
    pub terminal_cli: Option<CliInfo>,
    pub desktop_installed: bool,
    pub desktop_bundled_versions: Vec<String>,
    /// 설치·업데이트 명령에 실제로 쓰는 CLI
    pub active_cli: Option<CliInfo>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub name: String,
    pub description: String,
    /// 슬래시 명령 뒤에 붙이는 인자 안내 (frontmatter `argument-hint`)
    pub argument_hint: Option<String>,
    /// `/` 메뉴에서 직접 부를 수 있는지 (`user-invocable: false`면 false)
    pub user_invocable: bool,
    /// Claude가 상황을 보고 자동으로 부를 수 있는지 (`disable-model-invocation: true`면 false)
    pub model_invocable: bool,
    /// 예시 요청 문장 (frontmatter `examples[].utterance`)
    pub examples: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Components {
    pub skills: Vec<Component>,
    pub commands: Vec<Component>,
    pub agents: Vec<Component>,
    pub hooks: Vec<String>,
    pub mcp_servers: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    /// name@marketplace
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub marketplace: String,
    /// "cli" (터미널·Claude Code) | "desktop" (Claude 앱 계정 동기화)
    pub surface: String,
    pub enabled: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub scope: Option<String>,
    /// 폴더 범위(project/local)로 설치된 경우 그 폴더
    pub project_path: Option<String>,
    pub install_path: Option<String>,
    pub path_exists: bool,
    pub manifest_ok: bool,
    pub description: String,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub components: Components,
    /// 이 앱에서 켜고 끌 수 있는지 (앱 동기화 플러그인은 읽기 전용)
    pub toggleable: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Marketplace {
    pub name: String,
    pub source: String,
    pub install_location: Option<String>,
    pub plugin_count: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    /// "remove-setting" | "reinstall" | "update" | "disable"
    pub kind: String,
    pub label: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub id: String,
    /// "error" | "warning" | "info"
    pub severity: String,
    pub plugin_id: Option<String>,
    pub title: String,
    pub detail: String,
    pub fix: Option<Fix>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub env: EnvInfo,
    pub plugins: Vec<Plugin>,
    pub marketplaces: Vec<Marketplace>,
    pub diagnostics: Vec<Diagnostic>,
    pub projects: Vec<ProjectState>,
    pub settings_error: Option<String>,
    pub scanned_at: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub plugin_id: String,
    pub name: String,
    pub description: String,
    pub marketplace: String,
    pub version: Option<String>,
    pub source_url: Option<String>,
    pub installable: bool,
    #[serde(flatten)]
    pub change: CatalogChange,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChange {
    /// 이전에 본 적 없는 플러그인
    pub is_new: bool,
    /// 이전에 본 버전과 달라진 플러그인
    pub updated: bool,
    pub first_seen: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<CatalogEntry>,
    /// "cli" | "local-cache"
    pub origin: String,
    pub fetched_at: u64,
    pub new_count: usize,
    pub updated_count: usize,
    /// 처음 실행이라 모두 "본 것"으로 기록한 경우
    pub first_run: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GuideCommand {
    pub command: String,
    pub description: String,
    #[serde(default)]
    pub usage: String,
    #[serde(default)]
    pub example: String,
}

/// AI가 만든 한국어 가이드
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Guide {
    pub summary: String,
    #[serde(default)]
    pub use_cases: Vec<String>,
    #[serde(default)]
    pub commands: Vec<GuideCommand>,
    #[serde(default)]
    pub tips: Vec<String>,
    #[serde(default)]
    pub cautions: Vec<String>,
    #[serde(default)]
    pub generated_at: u64,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub cli_found: bool,
    pub logged_in: bool,
    pub detail: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliResult {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// 마켓플레이스가 선언한 명령을 실행해야 하는 설치일 때, 사용자 확인이 필요한 내용
    pub needs_accept: Option<AcceptPrompt>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AcceptPrompt {
    pub sha256: String,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub plugin_ids: Vec<String>,
}

/// 사용자가 등록한 작업 폴더 (Claude Code 프로젝트)
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub path: String,
    pub name: String,
}

/// 폴더별 플러그인 설정 상태
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub is_git_repo: bool,
    /// .claude/settings.json (팀 공유)
    pub shared: std::collections::BTreeMap<String, bool>,
    /// .claude/settings.local.json (나만)
    pub local: std::collections::BTreeMap<String, bool>,
    pub shared_error: Option<String>,
    pub local_error: Option<String>,
}

fn default_scope() -> String {
    "user".into()
}
fn default_refresh() -> u32 {
    30
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    /// 새로 설치할 때 기본 범위: user | project | local
    #[serde(default = "default_scope")]
    pub default_install_scope: String,
    /// 기본 범위가 폴더일 때 그 폴더
    #[serde(default)]
    pub default_install_project: Option<String>,
    /// 마켓플레이스 원본 자동 확인 주기(분). 0이면 끔
    #[serde(default = "default_refresh")]
    pub remote_refresh_minutes: u32,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            default_install_scope: default_scope(),
            default_install_project: None,
            remote_refresh_minutes: default_refresh(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HubState {
    #[serde(default)]
    pub groups: Vec<Group>,
    #[serde(default)]
    pub projects: Vec<ProjectFolder>,
    #[serde(default)]
    pub prefs: Prefs,
}
