//! OS별 경로를 한곳에 모은 모듈.
//! Windows 확장 시 이 파일만 고치면 되도록, 다른 모듈은 경로를 직접 조립하지 않는다.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Claude Code 설정 루트. `CLAUDE_CONFIG_DIR`가 있으면 그것을 따른다.
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

/// 폴더(프로젝트)의 Claude Code 설정 파일. local=true면 개인용 settings.local.json
pub fn project_settings(project: &Path, local: bool) -> PathBuf {
    project
        .join(".claude")
        .join(if local { "settings.local.json" } else { "settings.json" })
}

/// Claude Code가 기억하는 작업 폴더 목록이 있는 파일
pub fn claude_global_config() -> PathBuf {
    match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(v) if !v.is_empty() => PathBuf::from(v).join(".claude.json"),
        _ => home().join(".claude.json"),
    }
}

pub fn known_marketplaces_file() -> PathBuf {
    plugins_dir().join("known_marketplaces.json")
}

/// Claude 데스크톱 앱의 데이터 폴더.
#[cfg(target_os = "macos")]
pub fn desktop_app_dir() -> PathBuf {
    home().join("Library").join("Application Support").join("Claude")
}

/// Windows: %APPDATA%\Claude (미검증, Windows 대응 단계에서 확인 예정)
#[cfg(not(target_os = "macos"))]
pub fn desktop_app_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(home).join("Claude")
}

/// 앱 계정에 동기화된 플러그인 목록이 들어 있는 폴더.
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

/// 터미널용 Claude Code CLI 후보 경로.
/// macOS GUI 앱은 셸 PATH를 물려받지 않으므로 흔한 설치 위치를 직접 더한다.
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

/// Claude 앱에 내장된 Claude Code 실행 파일들 (버전 내림차순).
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

/// 자식 프로세스(CLI)에 넘길 PATH. git 등 CLI가 의존하는 도구를 찾을 수 있게 한다.
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

/// "1.44.0" 같은 버전 문자열을 비교 가능한 숫자 배열로 바꾼다.
pub fn version_key(v: &str) -> Vec<u64> {
    v.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().unwrap_or(0))
        .collect()
}
