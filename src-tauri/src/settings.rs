use crate::paths;
use crate::scanner::now_ms;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const KEEP_BACKUPS: usize = 20;

fn backup(src: &Path, backup_dir: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
    let tag: String = src
        .parent()
        .and_then(|d| d.parent())
        .and_then(|d| d.file_name())
        .map(|n| n.to_string_lossy().chars().filter(|c| c.is_alphanumeric()).take(24).collect())
        .unwrap_or_default();
    let dst = backup_dir.join(format!("settings-{}-{tag}-{}", now_ms(), src.file_name().unwrap_or_default().to_string_lossy()));
    fs::copy(src, &dst).map_err(|e| format!("백업 실패: {e}"))?;

    let mut files: Vec<PathBuf> = fs::read_dir(backup_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().starts_with("settings-"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    if files.len() > KEEP_BACKUPS {
        for f in &files[..files.len() - KEEP_BACKUPS] {
            let _ = fs::remove_file(f);
        }
    }
    Ok(())
}

static WRITE_LOCK: Mutex<()> = Mutex::new(());
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    let target = if path.is_symlink() { fs::canonicalize(path).map_err(|e| e.to_string())? } else { path.to_path_buf() };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let tmp = target.with_file_name(format!(".{name}.pluginhub-{}-{}.tmp", std::process::id(), TMP_SEQ.fetch_add(1, Ordering::Relaxed)));
    let mut opts = fs::OpenOptions::new();
    // create_new: 미리 만들어 둔 같은 이름의 링크를 따라가 다른 파일을 덮어쓰지 않는다
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        // 원래 파일 권한을 유지한다 (예: API 키가 든 0600 settings.json이 0644로 바뀌지 않게)
        let mode = fs::metadata(&target).map(|m| m.permissions().mode() & 0o777).unwrap_or(0o644);
        opts.mode(mode);
    }
    let result = opts.open(&tmp).and_then(|mut f| {
        f.write_all(content.as_bytes())?;
        f.sync_all()
    });
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("쓰기 실패: {e}"));
    }
    // Windows에서는 백신이나 다른 프로그램이 파일을 잠깐 잡고 있으면 이름 바꾸기가 실패한다. 몇 번 다시 시도한다.
    let mut last = None;
    for attempt in 0..5 {
        match fs::rename(&tmp, &target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                if attempt < 4 {
                    std::thread::sleep(std::time::Duration::from_millis(80));
                }
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(format!("저장 실패: {}", last.map(|e| e.to_string()).unwrap_or_default()))
}

/// 폴더(프로젝트) 설정 파일 경로. `.claude` 폴더나 설정 파일이 링크로 프로젝트 밖(예: ~/.claude/settings.json)을
/// 가리키면 거부한다. 내려받은 저장소에 심어 둔 링크로 다른 설정 파일이 바뀌는 것을 막는다.
pub fn project_settings_checked(project: &Path, local: bool) -> Result<std::path::PathBuf, String> {
    let root = fs::canonicalize(project).map_err(|e| format!("폴더를 찾을 수 없습니다: {e}"))?;
    let file = paths::project_settings(project, local);
    for p in [file.parent().map(Path::to_path_buf), Some(file.clone())].into_iter().flatten() {
        if fs::symlink_metadata(&p).is_ok() {
            let real = fs::canonicalize(&p).map_err(|e| format!("{}: {e}", p.display()))?;
            if !real.starts_with(&root) {
                return Err(format!("{}가 폴더 밖({})을 가리키는 링크라서 수정하지 않습니다.", p.display(), real.display()));
            }
        }
    }
    Ok(file)
}

pub fn set_enabled(id: &str, enabled: Option<bool>, backup_dir: &Path) -> Result<(), String> {
    set_enabled_in(&paths::user_settings(), id, enabled, backup_dir)
}

pub fn set_enabled_in(p: &Path, id: &str, enabled: Option<bool>, backup_dir: &Path) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let p = p.to_path_buf();
    if enabled.is_none() && !p.exists() {
        return Ok(());
    }
    let mut root: Value = if p.exists() {
        let s = fs::read_to_string(&p).map_err(|e| e.to_string())?;
        if s.trim().is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::from_str(s.trim_start_matches('\u{feff}')).map_err(|e| {
                format!("settings.json 형식이 잘못되어 수정하지 않았습니다: {e}")
            })?
        }
    } else {
        Value::Object(Map::new())
    };
    let obj = root
        .as_object_mut()
        .ok_or("settings.json 최상위가 객체가 아닙니다")?;
    let ep = obj
        .entry("enabledPlugins")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("enabledPlugins 형식이 잘못되었습니다")?;
    match enabled {
        Some(b) => {
            ep.insert(id.to_string(), Value::Bool(b));
        }
        None => {
            ep.remove(id);
        }
    }
    if ep.is_empty() {
        obj.remove("enabledPlugins");
    }
    backup(&p, backup_dir)?;
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())? + "\n";
    write_atomic(&p, &text)
}
