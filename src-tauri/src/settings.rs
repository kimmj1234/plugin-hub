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
    let target = if path.is_symlink() { fs::canonicalize(path).map_err(|e| e.to_string())? } else { path.to_path_buf() };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let tmp = target.with_file_name(format!(".{name}.pluginhub-{}-{}.tmp", std::process::id(), TMP_SEQ.fetch_add(1, Ordering::Relaxed)));
    if let Err(e) = fs::write(&tmp, content) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("쓰기 실패: {e}"));
    }
    fs::rename(&tmp, &target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("저장 실패: {e}")
    })
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
            serde_json::from_str(&s).map_err(|e| {
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
