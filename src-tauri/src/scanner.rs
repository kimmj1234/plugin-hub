//! 설치된 플러그인과 마켓플레이스를 디스크에서 읽어 Snapshot을 만든다. (읽기 전용)

use crate::model::*;
use crate::{cli, paths, rules};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_json(p: &Path) -> Result<Value, String> {
    let s = fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
    if s.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&s).map_err(|e| format!("{} 형식 오류: {e}", p.display()))
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn split_id(id: &str) -> (String, String) {
    match id.rsplit_once('@') {
        Some((n, m)) => (n.to_string(), m.to_string()),
        None => (id.to_string(), String::new()),
    }
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    let s = s
        .strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .or_else(|| s.strip_prefix('\'').and_then(|x| x.strip_suffix('\'')))
        .unwrap_or(s);
    s.replace("\\\"", "\"").replace("''", "'")
}

/// SKILL.md / commands/*.md 의 YAML frontmatter에서 필요한 키만 간단히 뽑는다.
/// (YAML 라이브러리 없이 자주 쓰는 형태만 지원: 한 줄 값, `|`/`>` 여러 줄 값, examples 목록)
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: bool,
    pub model_invocable: bool,
    pub examples: Vec<String>,
}

pub fn parse_frontmatter(text: &str) -> Option<Frontmatter> {
    let mut lines = text.lines();
    if lines.next().map(|l| l.trim()) != Some("---") {
        return None;
    }
    let block: Vec<&str> = lines.take_while(|l| l.trim() != "---").collect();
    let get = |key: &str| -> Option<String> {
        let prefix = format!("{key}:");
        let idx = block.iter().position(|l| l.starts_with(&prefix))?;
        let raw = block[idx][prefix.len()..].trim();
        let value = if matches!(raw, "|" | ">" | "|-" | ">-" | "") {
            block[idx + 1..]
                .iter()
                .take_while(|l| l.starts_with(' ') || l.starts_with('\t'))
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            unquote(raw)
        };
        if value.is_empty() { None } else { Some(value) }
    };
    let flag = |key: &str| get(key).map(|v| v.eq_ignore_ascii_case("true"));
    let mut examples = Vec::new();
    if let Some(idx) = block.iter().position(|l| l.starts_with("examples:")) {
        for l in block[idx + 1..].iter().take_while(|l| l.starts_with(' ') || l.starts_with('\t') || l.starts_with('-')) {
            let t = l.trim().trim_start_matches("- ").trim();
            if let Some(v) = t.strip_prefix("utterance:") {
                examples.push(unquote(v));
            } else if l.trim_start().starts_with("- ") && !t.contains(':') {
                examples.push(unquote(t));
            }
        }
    }
    Some(Frontmatter {
        name: get("name"),
        description: get("description"),
        argument_hint: get("argument-hint"),
        user_invocable: flag("user-invocable").unwrap_or(true),
        model_invocable: !flag("disable-model-invocation").unwrap_or(false),
        examples,
    })
}

fn md_components(dir: &Path, nested_file: Option<&str>) -> Vec<Component> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        let (file, fallback) = match nested_file {
            Some(f) if p.is_dir() => (p.join(f), e.file_name().to_string_lossy().to_string()),
            None if p.extension().map(|x| x == "md").unwrap_or(false) => (
                p.clone(),
                p.file_stem().unwrap_or_default().to_string_lossy().to_string(),
            ),
            _ => continue,
        };
        if !file.is_file() {
            continue;
        }
        let fm = fs::read_to_string(&file).ok().and_then(|t| parse_frontmatter(&t));
        out.push(match fm {
            Some(f) => Component {
                name: f.name.unwrap_or(fallback),
                description: f.description.unwrap_or_default(),
                argument_hint: f.argument_hint,
                user_invocable: f.user_invocable,
                model_invocable: f.model_invocable,
                examples: f.examples,
            },
            None => Component {
                name: fallback,
                user_invocable: true,
                model_invocable: true,
                ..Default::default()
            },
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn components(root: &Path, manifest: &Value) -> Components {
    let mut c = Components {
        skills: md_components(&root.join("skills"), Some("SKILL.md")),
        commands: md_components(&root.join("commands"), None),
        agents: md_components(&root.join("agents"), None),
        ..Default::default()
    };
    if let Ok(h) = read_json(&root.join("hooks").join("hooks.json")) {
        if let Some(m) = h.get("hooks").and_then(|x| x.as_object()) {
            c.hooks = m.keys().cloned().collect();
        }
    }
    if let Some(m) = manifest.get("hooks").and_then(|x| x.as_object()) {
        for k in m.keys() {
            if !c.hooks.contains(k) {
                c.hooks.push(k.clone());
            }
        }
    }
    let mut mcp: Vec<String> = Vec::new();
    if let Ok(m) = read_json(&root.join(".mcp.json")) {
        let servers = m.get("mcpServers").unwrap_or(&m);
        if let Some(o) = servers.as_object() {
            mcp.extend(o.keys().cloned());
        }
    }
    if let Some(o) = manifest.get("mcpServers").and_then(|x| x.as_object()) {
        mcp.extend(o.keys().cloned());
    }
    mcp.sort();
    mcp.dedup();
    c.mcp_servers = mcp;
    c
}

struct ManifestInfo {
    ok: bool,
    value: Value,
}

fn manifest(root: &Path) -> ManifestInfo {
    match read_json(&root.join(".claude-plugin").join("plugin.json")) {
        Ok(v) if v.is_object() => ManifestInfo { ok: true, value: v },
        _ => ManifestInfo {
            ok: false,
            value: Value::Null,
        },
    }
}

fn author_of(m: &Value) -> Option<String> {
    match m.get("author") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Object(o)) => o.get("name").and_then(|x| x.as_str()).map(String::from),
        _ => None,
    }
}

fn repo_of(m: &Value) -> Option<String> {
    match m.get("repository") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Object(o)) => o.get("url").and_then(|x| x.as_str()).map(String::from),
        _ => None,
    }
}

pub struct SettingsInfo {
    pub enabled: BTreeMap<String, bool>,
    pub extra_marketplaces: HashSet<String>,
    pub error: Option<String>,
}

pub fn read_settings() -> SettingsInfo {
    let p = paths::user_settings();
    let mut info = SettingsInfo {
        enabled: BTreeMap::new(),
        extra_marketplaces: HashSet::new(),
        error: None,
    };
    if !p.exists() {
        return info;
    }
    match read_json(&p) {
        Ok(v) => {
            if let Some(m) = v.get("enabledPlugins").and_then(|x| x.as_object()) {
                for (k, val) in m {
                    info.enabled.insert(k.clone(), val.as_bool().unwrap_or(false));
                }
            }
            if let Some(m) = v.get("extraKnownMarketplaces").and_then(|x| x.as_object()) {
                info.extra_marketplaces.extend(m.keys().cloned());
            }
        }
        Err(e) => info.error = Some(e),
    }
    info
}

/// 마켓플레이스 목록과, 각 마켓플레이스가 제공하는 플러그인의 최신 버전(name@mkt -> version).
fn read_marketplaces() -> (Vec<Marketplace>, HashMap<String, String>) {
    let mut list = Vec::new();
    let mut versions = HashMap::new();
    let Ok(v) = read_json(&paths::known_marketplaces_file()) else {
        return (list, versions);
    };
    let Some(obj) = v.as_object() else {
        return (list, versions);
    };
    for (name, m) in obj {
        let src = m.get("source").cloned().unwrap_or(Value::Null);
        let source = str_of(&src, "repo")
            .or_else(|| str_of(&src, "url"))
            .or_else(|| str_of(&src, "path"))
            .unwrap_or_else(|| src.to_string());
        let loc = str_of(m, "installLocation");
        let mut count = 0;
        if let Some(l) = &loc {
            let mf = PathBuf::from(l).join(".claude-plugin").join("marketplace.json");
            if let Ok(mv) = read_json(&mf) {
                if let Some(arr) = mv.get("plugins").and_then(|x| x.as_array()) {
                    count = arr.len();
                    for p in arr {
                        if let (Some(n), Some(ver)) = (str_of(p, "name"), str_of(p, "version")) {
                            versions.insert(format!("{n}@{name}"), ver);
                        }
                    }
                }
            }
        }
        list.push(Marketplace {
            name: name.clone(),
            source,
            install_location: loc,
            plugin_count: count,
        });
    }
    list.sort_by(|a, b| a.name.cmp(&b.name));
    (list, versions)
}

fn build_plugin(
    id: &str,
    surface: &str,
    enabled: bool,
    install: Option<&Value>,
    install_path: Option<String>,
) -> Plugin {
    let (name, marketplace) = split_id(id);
    let path_exists = install_path
        .as_ref()
        .map(|p| Path::new(p).is_dir())
        .unwrap_or(false);
    let man = install_path
        .as_ref()
        .filter(|_| path_exists)
        .map(|p| manifest(Path::new(p)))
        .unwrap_or(ManifestInfo {
            ok: false,
            value: Value::Null,
        });
    let comps = install_path
        .as_ref()
        .filter(|_| path_exists)
        .map(|p| components(Path::new(p), &man.value))
        .unwrap_or_default();
    let display_name = str_of(&man.value, "name").unwrap_or_else(|| name.clone());
    Plugin {
        id: id.to_string(),
        name,
        display_name,
        marketplace,
        surface: surface.into(),
        enabled,
        installed: install_path.is_some(),
        version: install
            .and_then(|i| str_of(i, "version"))
            .or_else(|| str_of(&man.value, "version")),
        latest_version: None,
        scope: install.and_then(|i| str_of(i, "scope")),
        install_path,
        path_exists,
        manifest_ok: man.ok,
        description: str_of(&man.value, "description").unwrap_or_default(),
        author: author_of(&man.value),
        homepage: str_of(&man.value, "homepage"),
        repository: repo_of(&man.value),
        components: comps,
        toggleable: surface == "cli",
    }
}

/// 터미널·Claude Code 쪽 플러그인 (~/.claude)
fn cli_plugins(settings: &SettingsInfo, latest: &HashMap<String, String>) -> Vec<Plugin> {
    let mut installed: BTreeMap<String, Value> = BTreeMap::new();
    if let Ok(v) = read_json(&paths::installed_plugins_file()) {
        if let Some(m) = v.get("plugins").and_then(|x| x.as_object()) {
            for (id, entries) in m {
                // 여러 범위(user/project)에 설치된 경우 user를 우선 표시한다.
                if let Some(arr) = entries.as_array() {
                    let pick = arr
                        .iter()
                        .find(|e| str_of(e, "scope").as_deref() == Some("user"))
                        .or_else(|| arr.first());
                    if let Some(e) = pick {
                        installed.insert(id.clone(), e.clone());
                    }
                }
            }
        }
    }
    let mut ids: Vec<String> = installed.keys().cloned().collect();
    for k in settings.enabled.keys() {
        if !installed.contains_key(k) {
            ids.push(k.clone());
        }
    }
    ids.into_iter()
        .map(|id| {
            let inst = installed.get(&id);
            let path = inst.and_then(|i| str_of(i, "installPath"));
            let enabled = settings.enabled.get(&id).copied().unwrap_or(false);
            let mut p = build_plugin(&id, "cli", enabled, inst, path);
            p.latest_version = latest.get(&id).cloned();
            p
        })
        .collect()
}

/// Claude 앱(계정 동기화) 쪽 플러그인. 앱이 서버와 동기화하므로 읽기 전용으로 다룬다.
fn desktop_plugins() -> Vec<Plugin> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let root = paths::desktop_plugin_list_dir();
    let Ok(orgs) = fs::read_dir(&root) else {
        return out;
    };
    for org in orgs.flatten() {
        let Ok(accounts) = fs::read_dir(org.path()) else {
            continue;
        };
        for acc in accounts.flatten() {
            let Ok(v) = read_json(&acc.path().join("plugins.json")) else {
                continue;
            };
            let Some(arr) = v.get("plugins").and_then(|x| x.as_array()) else {
                continue;
            };
            for e in arr {
                let Some(id) = str_of(e, "id") else { continue };
                if !seen.insert(id.clone()) {
                    continue;
                }
                let enabled = e.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false);
                let path = str_of(e, "installPath");
                out.push(build_plugin(&id, "desktop", enabled, Some(e), path));
            }
        }
    }
    out.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    out
}

pub fn env_info() -> EnvInfo {
    let home = paths::claude_home();
    EnvInfo {
        os: std::env::consts::OS.into(),
        claude_home_exists: home.is_dir(),
        claude_home: home.to_string_lossy().to_string(),
        terminal_cli: cli::find_terminal_cli(),
        desktop_installed: paths::desktop_installed(),
        desktop_bundled_versions: paths::bundled_cli_versions().into_iter().map(|v| v.0).collect(),
        active_cli: cli::active_cli(),
    }
}

pub fn scan() -> Snapshot {
    let settings = read_settings();
    let (marketplaces, latest) = read_marketplaces();
    let mut plugins = cli_plugins(&settings, &latest);
    plugins.extend(desktop_plugins());
    let diagnostics = rules::evaluate(&plugins, &settings, &marketplaces);
    Snapshot {
        env: env_info(),
        plugins,
        marketplaces,
        diagnostics,
        settings_error: settings.error,
        scanned_at: now_ms(),
    }
}
