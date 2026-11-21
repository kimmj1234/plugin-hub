use crate::model::{Catalog, CatalogChange, CatalogEntry};
use crate::scanner::{now_ms, read_json};
use crate::{cli, paths};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Duration;

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(String::from)
}

fn source_url(src: &Value) -> Option<String> {
    match src {
        Value::String(x) => Some(x.clone()),
        Value::Object(_) => s(src, "url")
            .or_else(|| s(src, "repo").map(|r| format!("https://github.com/{r}")))
            .map(|u| u.trim_end_matches(".git").to_string()),
        _ => None,
    }
}

fn from_cli() -> Result<Vec<CatalogEntry>, String> {
    let r = cli::run(
        &["plugin", "list", "--available", "--json"],
        Duration::from_secs(120),
    )?;
    if !r.ok {
        return Err(format!("카탈로그 조회 실패: {}", r.stderr.trim()));
    }
    let v: Value = serde_json::from_str(r.stdout.trim())
        .map_err(|e| format!("카탈로그 형식 오류: {e}"))?;
    let arr = v
        .get("available")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(arr
        .iter()
        .filter_map(|e| {
            let id = s(e, "pluginId")?;
            Some(CatalogEntry {
                name: s(e, "name").unwrap_or_else(|| id.clone()),
                description: s(e, "description").unwrap_or_default(),
                marketplace: s(e, "marketplaceName").unwrap_or_default(),
                version: s(e, "version"),
                source_url: e.get("source").and_then(source_url),
                installable: true,
                change: CatalogChange::default(),
                plugin_id: id,
            })
        })
        .collect())
}

fn from_local_cache() -> Vec<CatalogEntry> {
    let Ok(v) = read_json(&paths::plugins_dir().join("plugin-directory-cache-v2.json")) else {
        return Vec::new();
    };
    v.get("listings")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    let name = s(e, "name")?;
                    Some(CatalogEntry {
                        plugin_id: name.clone(),
                        description: s(e, "summary").unwrap_or_default(),
                        marketplace: "anthropic-plugin-directory".into(),
                        version: e.get("release").and_then(|r| s(r, "version")),
                        source_url: e
                            .get("source")
                            .and_then(|x| x.get("repository"))
                            .and_then(|r| s(r, "url")),
                        installable: false,
                        change: CatalogChange::default(),
                        name,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

const NEW_BADGE_MS: u64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Serialize, Deserialize, Default)]
struct Seen {
    #[serde(default)]
    versions: HashMap<String, String>,
    #[serde(default)]
    first_seen: HashMap<String, u64>,
    #[serde(default)]
    updated_at: HashMap<String, u64>,
}

fn track_changes(entries: &mut [CatalogEntry], data_dir: &Path) -> (usize, usize, bool) {
    let file = data_dir.join("catalog-seen.json");
    let first_run = !file.exists();
    let mut seen: Seen = fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let now = now_ms();
    let (mut new_count, mut updated_count) = (0, 0);
    for e in entries.iter_mut() {
        let ver = e.version.clone().unwrap_or_default();
        let first = *seen
            .first_seen
            .entry(e.plugin_id.clone())
            .or_insert(if first_run { 0 } else { now });
        match seen.versions.get(&e.plugin_id) {
            Some(old) if old != &ver && !ver.is_empty() => {
                seen.updated_at.insert(e.plugin_id.clone(), now);
            }
            _ => {}
        }
        seen.versions.insert(e.plugin_id.clone(), ver);
        let is_new = first > 0 && now.saturating_sub(first) < NEW_BADGE_MS;
        let updated = !is_new
            && seen
                .updated_at
                .get(&e.plugin_id)
                .map(|t| now.saturating_sub(*t) < NEW_BADGE_MS)
                .unwrap_or(false);
        new_count += is_new as usize;
        updated_count += updated as usize;
        e.change = CatalogChange {
            is_new,
            updated,
            first_seen: first,
        };
    }
    let _ = fs::create_dir_all(data_dir);
    if let Ok(text) = serde_json::to_string(&seen) {
        let tmp = file.with_extension("json.tmp");
        if fs::write(&tmp, text).is_ok() {
            let _ = fs::rename(&tmp, &file);
        }
    }
    (new_count, updated_count, first_run)
}

pub fn load(data_dir: &Path) -> Result<Catalog, String> {
    let (mut entries, origin) = match from_cli() {
        Ok(entries) => (entries, "cli"),
        Err(e) => {
            let entries = from_local_cache();
            if entries.is_empty() {
                return Err(e);
            }
            (entries, "local-cache")
        }
    };
    let (new_count, updated_count, first_run) = track_changes(&mut entries, data_dir);
    Ok(Catalog {
        entries,
        origin: origin.into(),
        fetched_at: now_ms(),
        new_count,
        updated_count,
        first_run,
    })
}

pub fn update_marketplaces() -> Result<String, String> {
    let r = cli::run(&["plugin", "marketplace", "update"], Duration::from_secs(180))?;
    if r.ok {
        Ok(r.stdout.trim().to_string())
    } else {
        Err(format!("마켓플레이스 업데이트 실패: {}", r.stderr.trim()))
    }
}

#[cfg(test)]
pub fn track_changes_for_test(entries: &mut [CatalogEntry], data_dir: &Path) -> (usize, usize, bool) {
    track_changes(entries, data_dir)
}
