mod catalog;
mod cli;
mod guide;
mod model;
mod paths;
mod rules;
mod scanner;
mod settings;
mod store;
#[cfg(test)]
mod tests;
mod watcher;

use model::{AiStatus, Catalog, CliResult, Guide, HubState, Snapshot};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
struct AppState {
    catalog: Mutex<Option<Catalog>>,
}

/// 카탈로그 캐시 유지 시간
const CATALOG_TTL_MS: u64 = 10 * 60 * 1000;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn scan() -> Result<Snapshot, String> {
    blocking(|| Ok(scanner::scan())).await
}

#[tauri::command]
async fn set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
    scope: Option<String>,
) -> Result<(), String> {
    cli::validate_id(&id)?;
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    let backups = data_dir(&app)?.join("backups");
    blocking(move || {
        if scope == "user" {
            settings::set_enabled(&id, Some(enabled), &backups)
        } else {
            let verb = if enabled { "enable" } else { "disable" };
            let r = cli::run(&["plugin", verb, &id, "-s", &scope], Duration::from_secs(60))?;
            if r.ok {
                Ok(())
            } else {
                Err(format!("{}{}", r.stderr.trim(), r.stdout.trim()))
            }
        }
    })
    .await
}

#[tauri::command]
async fn remove_setting(app: AppHandle, id: String) -> Result<(), String> {
    cli::validate_id(&id)?;
    let backups = data_dir(&app)?.join("backups");
    blocking(move || settings::set_enabled(&id, None, &backups)).await
}

#[tauri::command]
async fn install_plugin(
    state: State<'_, AppState>,
    id: String,
    accept_sha: Option<String>,
) -> Result<CliResult, String> {
    cli::validate_id(&id)?;
    if let Some(s) = &accept_sha {
        if !s.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("잘못된 확인 값입니다".into());
        }
    }
    if let Ok(mut c) = state.catalog.lock() {
        *c = None;
    }
    blocking(move || {
        let mut args = vec!["plugin", "install", id.as_str(), "-s", "user", "--json"];
        if let Some(s) = accept_sha.as_deref() {
            args.push("--accept-command");
            args.push(s);
        }
        cli::run(&args, Duration::from_secs(300))
    })
    .await
}

#[tauri::command]
async fn uninstall_plugin(id: String, scope: Option<String>) -> Result<CliResult, String> {
    cli::validate_id(&id)?;
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    blocking(move || {
        cli::run(
            &["plugin", "uninstall", &id, "-s", &scope],
            Duration::from_secs(120),
        )
    })
    .await
}

#[tauri::command]
async fn update_plugin(id: String, scope: Option<String>) -> Result<CliResult, String> {
    cli::validate_id(&id)?;
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    blocking(move || {
        cli::run(
            &["plugin", "update", &id, "-s", &scope],
            Duration::from_secs(300),
        )
    })
    .await
}

#[tauri::command]
async fn add_marketplace(state: State<'_, AppState>, source: String) -> Result<CliResult, String> {
    let source = source.trim().to_string();
    if source.is_empty() || source.starts_with('-') || source.chars().any(|c| c.is_whitespace()) {
        return Err("마켓플레이스 주소 형식이 올바르지 않습니다 (예: owner/repo)".into());
    }
    if let Ok(mut c) = state.catalog.lock() {
        *c = None;
    }
    blocking(move || {
        cli::run(
            &["plugin", "marketplace", "add", &source],
            Duration::from_secs(180),
        )
    })
    .await
}

#[tauri::command]
async fn get_catalog(app: AppHandle, state: State<'_, AppState>, refresh: bool) -> Result<Catalog, String> {
    if !refresh {
        if let Ok(c) = state.catalog.lock() {
            if let Some(cat) = c.as_ref() {
                if scanner::now_ms().saturating_sub(cat.fetched_at) < CATALOG_TTL_MS {
                    return Ok(cat.clone());
                }
            }
        }
    }
    let dir = data_dir(&app)?;
    let cat = blocking(move || catalog::load(&dir)).await?;
    if let Ok(mut c) = state.catalog.lock() {
        *c = Some(cat.clone());
    }
    Ok(cat)
}

/// 마켓플레이스를 원본에서 다시 받아 새 플러그인·업데이트를 가져온다.
#[tauri::command]
async fn update_marketplaces(state: State<'_, AppState>) -> Result<String, String> {
    let r = blocking(catalog::update_marketplaces).await;
    if let Ok(mut c) = state.catalog.lock() {
        *c = None;
    }
    r
}

#[tauri::command]
async fn ai_status() -> Result<AiStatus, String> {
    blocking(|| Ok(guide::status())).await
}

#[tauri::command]
fn open_login() -> Result<(), String> {
    guide::open_login_terminal()
}

/// 저장된 한국어 가이드 (없으면 null)
#[tauri::command]
fn get_guide(app: AppHandle, id: String, version: Option<String>) -> Result<Option<Guide>, String> {
    Ok(guide::cached(&data_dir(&app)?, &id, version.as_deref()))
}

/// 한국어 가이드 생성. 설치된 플러그인이면 디스크의 구성 요소·README를 근거로 쓰고,
/// 설치 전 플러그인이면 카탈로그의 이름·설명만으로 만든다.
#[tauri::command]
async fn generate_guide(
    app: AppHandle,
    id: String,
    surface: Option<String>,
    version: Option<String>,
    name: Option<String>,
    description: Option<String>,
) -> Result<Guide, String> {
    let dir = data_dir(&app)?;
    blocking(move || {
        let snap = scanner::scan();
        let installed = snap
            .plugins
            .iter()
            .find(|p| p.id == id && surface.as_deref().map(|s| s == p.surface).unwrap_or(true) && p.path_exists);
        let (context, ver) = match installed {
            Some(p) => (guide::context_from_plugin(p), p.version.clone()),
            None => (
                format!(
                    "플러그인 이름: {}\n식별자: {id}\n설명: {}\n(아직 설치되지 않아 구성 요소 정보가 없다. 설명만으로 요약하고 commands는 빈 배열로 둔다.)\n",
                    name.unwrap_or_else(|| id.clone()),
                    description.unwrap_or_default()
                ),
                version,
            ),
        };
        guide::generate(&dir, &id, ver.as_deref(), &context)
    })
    .await
}

/// README는 프론트에서 받은 경로가 아니라 스캔 결과의 설치 경로로만 읽는다.
#[tauri::command]
async fn read_readme(id: String, surface: String) -> Result<Option<String>, String> {
    blocking(move || {
        let snap = scanner::scan();
        let Some(p) = snap
            .plugins
            .iter()
            .find(|p| p.id == id && p.surface == surface)
        else {
            return Ok(None);
        };
        let Some(dir) = p.install_path.as_ref() else {
            return Ok(None);
        };
        for name in ["README.md", "readme.md", "README.MD"] {
            let f = PathBuf::from(dir).join(name);
            if let Ok(text) = std::fs::read_to_string(&f) {
                let mut t = text;
                if t.len() > 200_000 {
                    let mut cut = 200_000;
                    while !t.is_char_boundary(cut) {
                        cut -= 1;
                    }
                    t.truncate(cut);
                }
                return Ok(Some(t));
            }
        }
        Ok(None)
    })
    .await
}

#[tauri::command]
fn get_groups(app: AppHandle) -> Result<HubState, String> {
    Ok(store::load(&data_dir(&app)?))
}

#[tauri::command]
fn save_groups(app: AppHandle, state: HubState) -> Result<(), String> {
    store::save(&data_dir(&app)?, &state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            watcher::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan,
            set_enabled,
            remove_setting,
            install_plugin,
            uninstall_plugin,
            update_plugin,
            add_marketplace,
            get_catalog,
            update_marketplaces,
            ai_status,
            open_login,
            get_guide,
            generate_guide,
            read_readme,
            get_groups,
            save_groups
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
