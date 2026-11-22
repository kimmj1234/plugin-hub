//! 폴더 범위(project/local)로 설치한 뒤 그 폴더가 삭제된 플러그인의 설치 기록 정리.
//!
//! Claude Code는 폴더 범위 플러그인을 그 폴더 안에서 실행해야만 삭제한다(다른 곳에서 실행하면
//! "not installed in local scope"). 폴더가 이미 없으면 공식 명령으로도 지울 수 없으므로,
//! 같은 경로에 빈 폴더를 잠깐 만들어 공식 명령을 실행한 뒤 이 앱이 만든 폴더만 지운다.

use std::fs;
use std::path::{Path, PathBuf};

/// 이 경로가 "삭제된 폴더"로 볼 만한지. 외장 디스크를 뺐거나 네트워크 폴더가 끊긴 경우도 경로가
/// 없다고 나오는데, 그때 "삭제됨"으로 정리하면 디스크를 다시 연결했을 때 설치 기록이 사라져 있다.
/// 그래서 가장 가까운 상위 폴더가 실제로 있고, 그것이 디스크·마운트 최상위가 아닐 때만 삭제로 본다.
pub fn deletion_plausible(dir: &Path) -> bool {
    use std::path::Component;
    if !dir.is_absolute() || dir.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return false;
    }
    if dir.exists() {
        return false;
    }
    let Some(top) = topmost_missing(dir) else { return false };
    let Some(anchor) = top.parent() else { return false };
    if anchor.parent().is_none() {
        // 최상위(/ 또는 C:\) 바로 아래가 없어졌다: 디스크 자체가 빠진 경우일 수 있다
        return false;
    }
    #[cfg(unix)]
    {
        const MOUNT_ROOTS: &[&str] = &["/Volumes", "/mnt", "/media", "/run/media"];
        if MOUNT_ROOTS.iter().any(|m| anchor == Path::new(m)) {
            return false;
        }
        if anchor.starts_with("/run/media") && anchor.components().count() <= 4 {
            return false;
        }
    }
    anchor.is_dir()
}

static CLEANUP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `dir`을 만들 때 새로 생기는 가장 바깥 폴더. 이미 있으면 None.
pub fn topmost_missing(dir: &Path) -> Option<PathBuf> {
    if dir.exists() {
        return None;
    }
    let mut top = dir.to_path_buf();
    while let Some(parent) = top.parent() {
        if parent.as_os_str().is_empty() || parent.exists() {
            break;
        }
        top = parent.to_path_buf();
    }
    Some(top)
}

/// 정리 명령이 남길 수 있는 것만 들어 있는지 확인한다: 폴더, 그리고 `.claude` 안의 json 파일.
/// 그 밖의 파일이나 링크가 있으면(그 사이에 누군가 폴더를 다시 쓰기 시작했다면) 지우지 않는다.
pub fn only_cleanup_leftovers(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false };
    for e in entries.flatten() {
        let Ok(meta) = fs::symlink_metadata(e.path()) else { return false };
        if meta.is_dir() {
            if !only_cleanup_leftovers(&e.path()) {
                return false;
            }
        } else if meta.is_file() {
            let in_claude = dir.file_name().is_some_and(|n| n == ".claude");
            let json = e.path().extension().is_some_and(|x| x == "json");
            if !(in_claude && json) {
                return false;
            }
        } else {
            return false;
        }
    }
    true
}

/// 없어진 `dir`을 잠깐 만들고 `f`를 실행한 뒤, 이 함수가 만든 폴더를 지운다.
/// 반환값의 bool은 임시 폴더를 깨끗이 지웠는지 여부.
pub fn with_temp_folder<T>(dir: &Path, f: impl FnOnce(&Path) -> Result<T, String>) -> Result<(T, bool), String> {
    let _guard = CLEANUP_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !dir.is_absolute() {
        return Err("절대 경로가 아닙니다".into());
    }
    let Some(top) = topmost_missing(dir) else {
        return Err("폴더가 이미 있습니다. 일반 삭제를 사용하세요.".into());
    };
    if !deletion_plausible(dir) {
        return Err("이 폴더는 삭제된 것이 아니라 외장 디스크나 네트워크 폴더가 연결되지 않은 것일 수 있습니다. 다시 연결한 뒤 일반 삭제를 사용하세요.".into());
    }
    fs::create_dir_all(dir).map_err(|e| format!("임시 폴더를 만들 수 없습니다: {e}"))?;
    let result = f(dir);
    let removed = only_cleanup_leftovers(&top) && fs::remove_dir_all(&top).is_ok();
    result.map(|v| (v, removed))
}
