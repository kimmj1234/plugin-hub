//! ~/.claude/settings.json 의 enabledPlugins 직접 수정.
//! 사용자 범위 ON/OFF는 즉시 반영되도록 CLI를 거치지 않고 이 모듈이 처리한다.
//! 다른 설정 키와 순서는 그대로 보존하고, 수정 전 백업을 남긴다.

use crate::paths;
use crate::scanner::now_ms;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

const KEEP_BACKUPS: usize = 20;

fn backup(src: &Path, backup_dir: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(backup_dir).map_err(|e| e.to_string())?;
    let dst = backup_dir.join(format!("settings-{}.json", now_ms()));
    fs::copy(src, &dst).map_err(|e| format!("백업 실패: {e}"))?;

    // 오래된 백업 정리
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

fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.pluginhub-tmp");
    fs::write(&tmp, content).map_err(|e| format!("쓰기 실패: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("저장 실패: {e}"))
}

/// enabled = Some(true/false) 이면 값을 설정하고, None 이면 항목을 제거한다.
pub fn set_enabled(id: &str, enabled: Option<bool>, backup_dir: &Path) -> Result<(), String> {
    let p = paths::user_settings();
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
    backup(&p, backup_dir)?;
    let text = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())? + "\n";
    write_atomic(&p, &text)
}
