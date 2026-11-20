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
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<CatalogEntry>,
    /// "cli" | "local-cache"
    pub origin: String,
    pub fetched_at: u64,
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

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HubState {
    pub groups: Vec<Group>,
}
