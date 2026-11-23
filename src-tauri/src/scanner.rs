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

/// 파일 크기 상한 (바이트)
pub const MAX_CONFIG_BYTES: u64 = 32 * 1024 * 1024; // 사용자·Claude가 쓰는 설정 파일
pub const MAX_PLUGIN_JSON_BYTES: u64 = 1024 * 1024; // 외부 플러그인이 넣은 JSON
pub const MAX_PLUGIN_TEXT_BYTES: u64 = 256 * 1024; // 외부 플러그인의 SKILL.md·명령 문서
pub const MAX_README_BYTES: u64 = 200 * 1024;

/// 크기를 제한해 읽는다. `allow_symlink`가 false면 심볼릭 링크·장치 파일·폴더를 거부한다.
/// 외부 플러그인 파일이 /dev/zero 같은 장치나 거대한 파일, 또는 ~/.ssh 같은 다른 파일을 가리키는 링크여도
/// 앱이 멈추거나 그 내용이 화면·AI 프롬프트로 새어 나가지 않게 한다.
pub fn read_limited(p: &Path, max: u64, allow_symlink: bool) -> Result<String, String> {
    use std::io::Read;
    let meta = if allow_symlink { fs::metadata(p) } else { fs::symlink_metadata(p) }.map_err(|e| format!("{}: {e}", p.display()))?;
    if !meta.is_file() {
        return Err(format!("{}: 일반 파일이 아닙니다", p.display()));
    }
    if meta.len() > max {
        return Err(format!("{}: 파일이 너무 큽니다 ({}바이트 초과)", p.display(), max));
    }
    let mut buf = Vec::new();
    fs::File::open(p)
        .and_then(|f| f.take(max).read_to_end(&mut buf))
        .map_err(|e| format!("{}: {e}", p.display()))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn parse_json(p: &Path, s: &str) -> Result<Value, String> {
    if s.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    // 메모장·PowerShell로 저장하면 앞에 BOM이 붙는다. 그대로 두면 형식 오류로 읽지 못한다.
    serde_json::from_str(s.trim_start_matches('\u{feff}')).map_err(|e| format!("{} 형식 오류: {e}", p.display()))
}

/// 사용자·Claude가 관리하는 설정 파일 (dotfiles 관리용 심볼릭 링크 허용)
pub fn read_json(p: &Path) -> Result<Value, String> {
    parse_json(p, &read_limited(p, MAX_CONFIG_BYTES, true)?)
}

/// 외부 플러그인·마켓플레이스가 제공한 JSON (링크 거부, 1MB 제한)
pub fn read_plugin_json(p: &Path) -> Result<Value, String> {
    parse_json(p, &read_limited(p, MAX_PLUGIN_JSON_BYTES, false)?)
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
        if let Some(c) = md_component(&file, fallback) {
            out.push(c);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 마크다운 파일 하나를 구성 요소로 읽는다 (프론트매터의 name·description)
fn md_component(file: &Path, fallback: String) -> Option<Component> {
    let fm = parse_frontmatter(&read_limited(file, MAX_PLUGIN_TEXT_BYTES, false).ok()?);
    Some(match fm {
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
    })
}

/// plugin.json의 "skills"/"commands"/"agents"에 적힌 추가 경로 (문자열 또는 배열).
/// 플러그인 폴더 밖을 가리키는 경로(절대 경로, .., 링크 탈출)는 무시한다.
fn manifest_paths(root: &Path, manifest: &Value, key: &str) -> Vec<PathBuf> {
    let list: Vec<&str> = match manifest.get(key) {
        Some(Value::String(s)) => vec![s.as_str()],
        Some(Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).collect(),
        _ => return vec![],
    };
    let Ok(base) = fs::canonicalize(root) else { return vec![] };
    list.into_iter()
        .filter(|s| !s.is_empty() && !Path::new(s).is_absolute())
        .filter_map(|s| fs::canonicalize(root.join(s)).ok())
        .filter(|p| p.starts_with(&base))
        .take(20)
        .collect()
}

/// 기본 폴더(skills/ 등) + plugin.json에 적힌 추가 경로에서 구성 요소를 모은다.
/// 스킬 경로는 SKILL.md가 바로 들어 있는 폴더(스킬 하나)이거나 스킬 폴더들을 담은 폴더일 수 있다.
fn collect(root: &Path, manifest: &Value, key: &str, default_dir: &str, nested: Option<&str>) -> Vec<Component> {
    let mut out = md_components(&root.join(default_dir), nested);
    let plugin_name = str_of(manifest, "name").unwrap_or_default();
    for p in manifest_paths(root, manifest, key) {
        if p.is_file() {
            let stem = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
            out.extend(md_component(&p, stem));
        } else if let Some(f) = nested.filter(|f| p.join(f).is_file()) {
            let fallback = if p == fs::canonicalize(root).unwrap_or_default() {
                plugin_name.clone()
            } else {
                p.file_name().unwrap_or_default().to_string_lossy().to_string()
            };
            out.extend(md_component(&p.join(f), fallback));
        } else if p.is_dir() {
            out.extend(md_components(&p, nested));
        }
    }
    let mut seen = HashSet::new();
    out.retain(|c| seen.insert(c.name.clone()));
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn components(root: &Path, manifest: &Value) -> Components {
    let mut c = Components {
        skills: collect(root, manifest, "skills", "skills", Some("SKILL.md")),
        commands: collect(root, manifest, "commands", "commands", None),
        agents: collect(root, manifest, "agents", "agents", None),
        ..Default::default()
    };
    if let Ok(h) = read_plugin_json(&root.join("hooks").join("hooks.json"))
        && let Some(m) = h.get("hooks").and_then(|x| x.as_object()) {
            c.hooks = m.keys().cloned().collect();
        }
    if let Some(m) = manifest.get("hooks").and_then(|x| x.as_object()) {
        for k in m.keys() {
            if !c.hooks.contains(k) {
                c.hooks.push(k.clone());
            }
        }
    }
    let mut mcp: Vec<String> = Vec::new();
    if let Ok(m) = read_plugin_json(&root.join(".mcp.json")) {
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
    match read_plugin_json(&root.join(".claude-plugin").join("plugin.json")) {
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
    pub installed_error: Option<String>,
    /// settings.json 또는 설치 기록이 방금 바뀌었는가
    pub recently_changed: bool,
}

/// 공식 CLI는 설치할 때 settings.json(켜짐)을 먼저 쓰고, 설치 기록은 몇 초 뒤에 쓴다(실측 약 2.8초).
/// 그 사이에 검사하면 "켜져 있지만 설치되지 않음"으로 잘못 보이므로, 최근에 바뀐 파일은 잠시 기다린다.
pub const INSTALL_GRACE_SECS: u64 = 30;

pub fn changed_within(p: &Path, secs: u64) -> bool {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .is_some_and(|d| d.as_secs() < secs)
}

pub fn read_settings() -> SettingsInfo {
    let p = paths::user_settings();
    let mut info = SettingsInfo {
        enabled: BTreeMap::new(),
        extra_marketplaces: HashSet::new(),
        error: None,
        installed_error: None,
        recently_changed: changed_within(&p, INSTALL_GRACE_SECS),
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

fn directory_marketplace(versions: &mut HashMap<String, String>) -> Option<Marketplace> {
    let v = read_json(&paths::plugin_directory_cache()).ok()?;
    let listings = v.get("listings")?.as_array()?;
    for l in listings {
        if let (Some(n), Some(ver)) = (str_of(l, "name"), l.get("release").and_then(|r| str_of(r, "version"))) {
            versions.insert(format!("{n}@{}", paths::DIRECTORY_MARKETPLACE), ver);
        }
    }
    Some(Marketplace {
        name: paths::DIRECTORY_MARKETPLACE.into(),
        source: "Claude Code 내장 공식 디렉터리".into(),
        install_location: None,
        plugin_count: listings.len(),
    })
}

fn read_marketplaces() -> (Vec<Marketplace>, HashMap<String, String>) {
    let mut list = Vec::new();
    let mut versions = HashMap::new();
    if let Some(d) = directory_marketplace(&mut versions) {
        list.push(d);
    }
    let obj = read_json(&paths::known_marketplaces_file())
        .ok()
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    for (name, m) in &obj {
        if name == paths::DIRECTORY_MARKETPLACE {
            list.retain(|x| x.name != *name);
        }
        let src = m.get("source").cloned().unwrap_or(Value::Null);
        let source = str_of(&src, "repo")
            .or_else(|| str_of(&src, "url"))
            .or_else(|| str_of(&src, "path"))
            .unwrap_or_else(|| src.to_string());
        let loc = str_of(m, "installLocation");
        let mut count = 0;
        if let Some(l) = &loc {
            let mf = PathBuf::from(l).join(".claude-plugin").join("marketplace.json");
            if let Ok(mv) = read_plugin_json(&mf)
                && let Some(arr) = mv.get("plugins").and_then(|x| x.as_array()) {
                    count = arr.len();
                    for p in arr {
                        if let (Some(n), Some(ver)) = (str_of(p, "name"), str_of(p, "version")) {
                            versions.insert(format!("{n}@{name}"), ver);
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
    let scope = install.and_then(|i| str_of(i, "scope"));
    let project_path = install.and_then(|i| str_of(i, "projectPath"));
    let folder_missing = matches!(scope.as_deref(), Some("project") | Some("local"))
        && project_path.as_deref().is_some_and(|p| crate::orphan::deletion_plausible(Path::new(p)));
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
        scope,
        project_path,
        install_path,
        path_exists,
        manifest_ok: man.ok,
        description: str_of(&man.value, "description").unwrap_or_default(),
        author: author_of(&man.value),
        homepage: str_of(&man.value, "homepage"),
        repository: repo_of(&man.value),
        components: comps,
        toggleable: surface == "cli",
        app_ref: None,
        installed_at: install.and_then(|i| str_of(i, "installedAt")),
        folder_missing,
        other_installs: Vec::new(),
    }
}

/// 폴더 범위 설치는 그 폴더 설정 파일에서, PC 전체 설치는 사용자 설정에서 켜짐 여부를 읽는다.
fn install_enabled(id: &str, scope: Option<&str>, project: Option<&str>, user: &BTreeMap<String, bool>) -> bool {
    match (scope, project) {
        (Some(sc @ ("project" | "local")), Some(pp)) => enabled_map(&paths::project_settings(Path::new(pp), sc == "local"))
            .0
            .get(id)
            .copied()
            .unwrap_or(false),
        _ => user.get(id).copied().unwrap_or(false),
    }
}

/// 설치하기 전에 구성 요소를 미리 본다. 마켓플레이스가 이 PC에 내려받아져 있고(installLocation)
/// 플러그인 소스가 그 안의 상대 경로일 때만 알 수 있다. 공식 디렉터리처럼 설치할 때 내려받는 경우는 None.
pub fn preview_components(id: &str) -> Option<Components> {
    let (name, market) = split_id(id);
    let known = read_json(&paths::known_marketplaces_file()).ok()?;
    let loc = PathBuf::from(str_of(known.get(&market)?, "installLocation")?);
    let mf = read_plugin_json(&loc.join(".claude-plugin").join("marketplace.json")).ok()?;
    let entry = mf.get("plugins")?.as_array()?.iter().find(|p| str_of(p, "name").as_deref() == Some(name.as_str()))?;
    let rel = entry.get("source")?.as_str()?;
    if Path::new(rel).is_absolute() || Path::new(rel).components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return None;
    }
    let root = loc.join(rel);
    let canon_root = fs::canonicalize(&root).ok()?;
    if !canon_root.starts_with(fs::canonicalize(&loc).ok()?) || !canon_root.is_dir() {
        return None;
    }
    let man = manifest(&canon_root);
    Some(components(&canon_root, &man.value))
}

fn read_installed() -> Result<Value, String> {
    let f = paths::installed_plugins_file();
    if !f.exists() {
        return Ok(Value::Null);
    }
    read_json(&f)
}

pub fn recorded_project_paths() -> Vec<String> {
    let Ok(v) = read_installed() else { return Vec::new() };
    v.get("plugins")
        .and_then(|x| x.as_object())
        .into_iter()
        .flat_map(|m| m.values())
        .filter_map(|e| e.as_array())
        .flatten()
        .filter_map(|e| str_of(e, "projectPath"))
        .collect()
}

fn cli_plugins(settings: &mut SettingsInfo, latest: &HashMap<String, String>) -> Vec<Plugin> {
    let mut installed: BTreeMap<String, Value> = BTreeMap::new();
    let mut others: HashMap<String, Vec<Value>> = HashMap::new();
    let data = match read_installed() {
        Ok(v) => v,
        Err(e) => {
            settings.installed_error = Some(e);
            Value::Null
        }
    };
    {
        if let Some(m) = data.get("plugins").and_then(|x| x.as_object()) {
            for (id, entries) in m {
                if let Some(arr) = entries.as_array() {
                    let pick = arr
                        .iter()
                        .find(|e| str_of(e, "scope").as_deref() == Some("user"))
                        .or_else(|| arr.first());
                    if let Some(e) = pick {
                        installed.insert(id.clone(), e.clone());
                        let rest: Vec<Value> = arr.iter().filter(|x| !std::ptr::eq(*x, e)).cloned().collect();
                        if !rest.is_empty() {
                            others.insert(id.clone(), rest);
                        }
                    }
                }
            }
        }
    }
    let mut ids: Vec<String> = installed.keys().cloned().collect();
    for (k, on) in &settings.enabled {
        // "이름@synced": false 는 Claude 앱이 계정 동기화 플러그인을 Claude Code에서 끄려고 적어 두는 표시다.
        // 설치된 것이 아니고 아무 효과도 없으므로 "설치되지 않은 플러그인"으로 보여 주지 않는다.
        if !on && k.ends_with("@synced") {
            continue;
        }
        if !installed.contains_key(k) {
            ids.push(k.clone());
        }
    }
    ids.into_iter()
        .map(|id| {
            let inst = installed.get(&id);
            let path = inst.and_then(|i| str_of(i, "installPath"));
            let scope = inst.and_then(|i| str_of(i, "scope"));
            let project = inst.and_then(|i| str_of(i, "projectPath"));
            let enabled = install_enabled(&id, scope.as_deref(), project.as_deref(), &settings.enabled);
            let mut p = build_plugin(&id, "cli", enabled, inst, path);
            p.latest_version = latest.get(&id).cloned();
            p.other_installs = others
                .get(&id)
                .into_iter()
                .flatten()
                .filter_map(|e| {
                    let scope = str_of(e, "scope")?;
                    let project_path = str_of(e, "projectPath");
                    let folder_missing = matches!(scope.as_str(), "project" | "local")
                        && project_path.as_deref().is_some_and(|pp| crate::orphan::deletion_plausible(Path::new(pp)));
                    Some(OtherInstall {
                        enabled: install_enabled(&id, Some(&scope), project_path.as_deref(), &settings.enabled),
                        version: str_of(e, "version"),
                        scope,
                        project_path,
                        folder_missing,
                    })
                })
                .collect();
            p
        })
        .collect()
}

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
                let app_ref = path
                    .as_deref()
                    .and_then(|p| Path::new(p).file_name())
                    .map(|n| n.to_string_lossy().to_string())
                    .filter(|n| n.starts_with("plugin_") && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'));
                let mut p = build_plugin(&id, "desktop", enabled, Some(e), path);
                p.app_ref = app_ref;
                out.push(p);
            }
        }
    }
    out.sort_by_key(|a| a.display_name.to_lowercase());
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

fn enabled_map(p: &Path) -> (BTreeMap<String, bool>, Option<String>) {
    let mut m = BTreeMap::new();
    if !p.exists() {
        return (m, None);
    }
    match read_json(p) {
        Ok(v) => {
            if let Some(o) = v.get("enabledPlugins").and_then(|x| x.as_object()) {
                for (k, val) in o {
                    m.insert(k.clone(), val.as_bool().unwrap_or(false));
                }
            }
            (m, None)
        }
        Err(e) => (m, Some(e)),
    }
}

pub fn project_states(projects: &[ProjectFolder]) -> Vec<ProjectState> {
    projects
        .iter()
        .map(|f| {
            let dir = Path::new(&f.path);
            let (shared, shared_error) = enabled_map(&paths::project_settings(dir, false));
            let (local, local_error) = enabled_map(&paths::project_settings(dir, true));
            ProjectState {
                path: f.path.clone(),
                name: f.name.clone(),
                exists: dir.is_dir(),
                is_git_repo: dir.join(".git").exists(),
                shared,
                local,
                shared_error,
                local_error,
                recently_changed: changed_within(&paths::project_settings(dir, false), INSTALL_GRACE_SECS)
                    || changed_within(&paths::project_settings(dir, true), INSTALL_GRACE_SECS),
            }
        })
        .collect()
}

pub fn suggested_projects() -> Vec<ProjectFolder> {
    let Ok(v) = read_json(&paths::claude_global_config()) else {
        return Vec::new();
    };
    let home = paths::home();
    let mut out: Vec<ProjectFolder> = v
        .get("projects")
        .and_then(|x| x.as_object())
        .map(|o| {
            o.keys()
                .filter(|k| Path::new(k).is_dir() && Path::new(k) != home)
                .map(|k| ProjectFolder {
                    name: Path::new(k).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| k.clone()),
                    path: k.clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn scan(projects: &[ProjectFolder]) -> Snapshot {
    let mut settings = read_settings();
    let (marketplaces, latest) = read_marketplaces();
    let mut plugins = cli_plugins(&mut settings, &latest);
    plugins.extend(desktop_plugins());
    let projects = project_states(projects);
    let diagnostics = rules::evaluate(&plugins, &settings, &marketplaces, &projects);
    Snapshot {
        env: env_info(),
        plugins,
        marketplaces,
        diagnostics,
        projects,
        settings_error: settings.error,
        scanned_at: now_ms(),
        watcher_ok: true,
    }
}
