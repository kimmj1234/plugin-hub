use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub path: String,
    pub version: Option<String>,
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
    pub active_cli: Option<CliInfo>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
    pub user_invocable: bool,
    pub model_invocable: bool,
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
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub marketplace: String,
    pub surface: String,
    pub enabled: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub scope: Option<String>,
    pub project_path: Option<String>,
    pub install_path: Option<String>,
    pub path_exists: bool,
    pub manifest_ok: bool,
    pub description: String,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub components: Components,
    pub toggleable: bool,
    pub app_ref: Option<String>,
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
    pub kind: String,
    pub label: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub id: String,
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
    pub directory_id: Option<String>,
    pub surfaces: Vec<String>,
    #[serde(flatten)]
    pub change: CatalogChange,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChange {
    pub is_new: bool,
    pub updated: bool,
    pub first_seen: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<CatalogEntry>,
    pub origin: String,
    pub fetched_at: u64,
    pub new_count: usize,
    pub updated_count: usize,
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

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolder {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectState {
    pub path: String,
    pub name: String,
    pub exists: bool,
    pub is_git_repo: bool,
    pub shared: std::collections::BTreeMap<String, bool>,
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
    #[serde(default = "default_scope")]
    pub default_install_scope: String,
    #[serde(default)]
    pub default_install_project: Option<String>,
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
