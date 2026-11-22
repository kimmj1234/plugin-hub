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

/// Claude Code 대화 기록(JSONL) 폴더. 사용 분석에만 읽기 전용으로 쓴다.
pub fn transcripts_dir() -> PathBuf {
    claude_home().join("projects")
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

pub const DIRECTORY_MARKETPLACE: &str = "anthropic-plugin-directory";

pub fn plugin_directory_cache() -> PathBuf {
    plugins_dir().join("plugin-directory-cache-v2.json")
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
            // 버전 폴더 바로 아래에 실행 파일이 있는 구조(claude-code/<버전>/claude.exe)도 지원
            let direct = b.path();
            if direct.is_file() && CLI_NAMES.iter().any(|n| direct.file_name().is_some_and(|f| f == *n)) {
                found.push((ver_name.clone(), direct));
                break;
            }
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
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW: 콘솔 창이 깜빡이지 않게
            .status();
    }
}

pub fn is_semver(v: &str) -> bool {
    let core = v.trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
    let parts: Vec<&str> = core.split('.').collect();
    !parts.is_empty() && parts.len() <= 4 && parts.iter().all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
}

pub fn version_key(v: &str) -> Vec<u64> {
    v.trim_start_matches('v')
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap_or(0))
        .collect()
}

/// 실제 경로(링크 해석). Windows의 `fs::canonicalize`는 `\\?\C:\...` 형태를 돌려주는데, 이 형태는
/// cmd.exe 작업 폴더로 쓸 수 없고 Claude Code가 기록하는 경로(`C:\...`)와도 문자열이 달라 일반 형태로 바꾼다.
pub fn canonical(p: &Path) -> std::io::Result<PathBuf> {
    let c = std::fs::canonicalize(p)?;
    Ok(strip_verbatim(c))
}

pub fn strip_verbatim(c: PathBuf) -> PathBuf {
    let s = c.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = s.strip_prefix(r"\\?\")
        && rest.as_bytes().get(1) == Some(&b':') {
            return PathBuf::from(rest);
        }
    c
}

/// Windows 시스템 폴더인지 (드라이브 문자·대소문자와 무관하게)
pub fn is_windows_system_path(s: &str) -> bool {
    let lower = s.to_lowercase().replace('/', "\\");
    let after_drive = match lower.as_bytes().get(1) {
        Some(b':') => &lower[2..],
        _ => return false,
    };
    ["\\windows", "\\program files", "\\program files (x86)", "\\programdata"]
        .iter()
        .any(|p| after_drive == *p || after_drive.starts_with(&format!("{p}\\")))
}

/// 작업 폴더로 등록하면 안 되는 위치. 시스템 폴더나 홈의 민감한 폴더에 설정 파일을 쓰지 않게 한다.
pub fn forbidden_project(dir: &Path) -> Option<&'static str> {
    let home = canonical(&home()).unwrap_or_else(|_| home());
    if dir == home || dir.parent().is_none() {
        return Some("홈 폴더나 최상위 폴더는 등록할 수 없습니다. 작업하는 프로젝트 폴더를 고르세요.");
    }
    #[cfg(unix)]
    const SYSTEM: &[&str] = &["/System", "/Library", "/private", "/usr", "/bin", "/sbin", "/etc", "/var", "/dev", "/Applications", "/opt", "/Volumes"];
    #[cfg(windows)]
    const SYSTEM: &[&str] = &[];
    if is_windows_system_path(&dir.to_string_lossy()) {
        return Some("시스템 폴더는 작업 폴더로 등록할 수 없습니다.");
    }
    // 외장 디스크(/Volumes/이름/…) 안의 프로젝트는 허용하고, /Volumes 바로 아래만 막는다
    if dir.starts_with("/Volumes") && dir.components().count() > 3 {
        return None;
    }
    if SYSTEM.iter().any(|s| dir.starts_with(s)) {
        return Some("시스템 폴더는 작업 폴더로 등록할 수 없습니다.");
    }
    let claude = canonical(&claude_home()).unwrap_or_else(|_| claude_home());
    for sensitive in [home.join("Library"), home.join(".ssh"), home.join(".config"), claude] {
        if dir.starts_with(&sensitive) {
            return Some("앱 설정·보안 폴더는 작업 폴더로 등록할 수 없습니다.");
        }
    }
    None
}
