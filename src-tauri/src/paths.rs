use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn claude_home() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => home().join(".claude"),
    }
}

pub fn user_settings() -> PathBuf {
    claude_home().join("settings.json")
}

pub fn plugins_dir() -> PathBuf {
    claude_home().join("plugins")
}

pub fn installed_plugins_file() -> PathBuf {
    plugins_dir().join("installed_plugins.json")
}

pub fn project_settings(project: &Path, local: bool) -> PathBuf {
    project
        .join(".claude")
        .join(if local { "settings.local.json" } else { "settings.json" })
}

pub fn claude_global_config() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(v) if !v.is_empty() => PathBuf::from(v).join(".claude.json"),
        _ => home().join(".claude.json"),
    }
}

pub fn known_marketplaces_file() -> PathBuf {
    plugins_dir().join("known_marketplaces.json")
}

#[cfg(target_os = "macos")]
pub fn desktop_app_dir() -> PathBuf {
    home().join("Library").join("Application Support").join("Claude")
}

#[cfg(not(target_os = "macos"))]
pub fn desktop_app_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(home).join("Claude")
}

pub fn desktop_plugin_list_dir() -> PathBuf {
    desktop_app_dir().join("plugin-list")
}

pub fn desktop_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        Path::new("/Applications/Claude.app").exists()
            || home().join("Applications").join("Claude.app").exists()
    }
    #[cfg(not(target_os = "macos"))]
    {
        desktop_app_dir().exists()
    }
}

#[cfg(windows)]
const CLI_NAMES: &[&str] = &["claude.exe", "claude.cmd"];
#[cfg(not(windows))]
const CLI_NAMES: &[&str] = &["claude"];

pub fn terminal_cli_candidates() -> Vec<PathBuf> {
    let mut dirs_list: Vec<PathBuf> = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        dirs_list.extend(std::env::split_paths(&path));
    }
    let h = home();
    dirs_list.push(h.join(".local").join("bin"));
    dirs_list.push(h.join(".claude").join("local"));
    dirs_list.push(h.join(".npm-global").join("bin"));
    #[cfg(not(windows))]
    {
        dirs_list.push(PathBuf::from("/opt/homebrew/bin"));
        dirs_list.push(PathBuf::from("/usr/local/bin"));
    }
    #[cfg(windows)]
    {
        if let Some(d) = dirs::data_dir() {
            dirs_list.push(d.join("npm"));
        }
    }
    let mut out = Vec::new();
    for d in dirs_list {
        for n in CLI_NAMES {
            out.push(d.join(n));
        }
    }
    out
}

pub fn bundled_cli_versions() -> Vec<(String, PathBuf)> {
    let root = desktop_app_dir().join("claude-code");
    let mut found = Vec::new();
    let Ok(versions) = std::fs::read_dir(&root) else {
        return found;
    };
    for ver in versions.flatten() {
        let ver_name = ver.file_name().to_string_lossy().to_string();
        let Ok(builds) = std::fs::read_dir(ver.path()) else {
            continue;
        };
        for b in builds.flatten() {
            let bin = bundled_binary(&b.path());
            if bin.is_file() {
                found.push((ver_name.clone(), bin));
                break;
            }
        }
    }
    found.sort_by(|a, b| version_key(&b.0).cmp(&version_key(&a.0)));
    found
}

#[cfg(target_os = "macos")]
fn bundled_binary(build_dir: &Path) -> PathBuf {
    build_dir
        .join("claude.app")
        .join("Contents")
        .join("MacOS")
        .join("claude")
}

#[cfg(not(target_os = "macos"))]
fn bundled_binary(build_dir: &Path) -> PathBuf {
    build_dir.join(CLI_NAMES[0])
}

pub fn child_path() -> OsString {
    let mut list: Vec<PathBuf> = Vec::new();
    let h = home();
    list.push(h.join(".local").join("bin"));
    #[cfg(not(windows))]
    {
        for p in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            list.push(PathBuf::from(p));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        list.extend(std::env::split_paths(&path));
    }
    std::env::join_paths(list).unwrap_or_default()
}

pub fn own_process_group(cmd: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_0200);
    }
}

pub fn kill_tree(pid: u32) {
    #[cfg(unix)]
    let _ = std::process::Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).status();
}

pub fn is_semver(v: &str) -> bool {
    let core = v.trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
    let parts: Vec<&str> = core.split('.').collect();
    !parts.is_empty() && parts.len() <= 4 && parts.iter().all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
}

pub fn version_key(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap_or(0))
        .collect()
}
