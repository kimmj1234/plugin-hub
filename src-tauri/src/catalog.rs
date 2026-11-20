//! 설치 가능한 플러그인 카탈로그 (검색용).
//! 1순위: `claude plugin list --available --json` (설치 가능한 공식 목록)
//! 2순위: CLI가 없을 때 Claude Code가 남긴 디렉터리 캐시 파일 (보기 전용)

use crate::model::{Catalog, CatalogEntry};
use crate::scanner::{now_ms, read_json};
use crate::{cli, paths};
use serde_json::Value;
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
                        name,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn load() -> Result<Catalog, String> {
    match from_cli() {
        Ok(entries) => Ok(Catalog {
            entries,
            origin: "cli".into(),
            fetched_at: now_ms(),
        }),
        Err(e) => {
            let entries = from_local_cache();
            if entries.is_empty() {
                Err(e)
            } else {
                Ok(Catalog {
                    entries,
                    origin: "local-cache".into(),
                    fetched_at: now_ms(),
                })
            }
        }
    }
}
