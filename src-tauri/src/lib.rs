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

fn hub_state(app: &AppHandle) -> Result<HubState, String> {
    Ok(store::load(&data_dir(app)?))
}

/// 프론트에서 받은 폴더 경로는 사용자가 등록한 폴더이거나,
/// 설치 기록(installed_plugins.json)에 남은 폴더일 때만 받아들인다. 임의 경로 쓰기 방지.
fn allowed_project(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let registered = hub_state(app)?.projects.iter().any(|p| p.path == path);
    let recorded = || {
        scanner::scan(&[])
            .plugins
            .iter()
            .any(|p| p.project_path.as_deref() == Some(path))
    };
    let dir = PathBuf::from(path);
    if !dir.is_absolute() || !(registered || recorded()) {
        return Err("등록되지 않은 폴더입니다. '적용 범위'에서 먼저 폴더를 추가하세요.".into());
    }
    if !dir.is_dir() {
        return Err(format!("폴더를 찾을 수 없습니다: {path}"));
    }
    Ok(dir)
}

#[tauri::command]
async fn scan(app: AppHandle) -> Result<Snapshot, String> {
    let projects = hub_state(&app)?.projects;
    blocking(move || Ok(scanner::scan(&projects))).await
}

/// 플러그인 목록의 토글. 플러그인이 설치된 범위의 설정 파일을 고친다.
/// user → ~/.claude/settings.json, project/local → 설치된 폴더의 .claude/settings(.local).json
#[tauri::command]
async fn set_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
    scope: Option<String>,
    project_path: Option<String>,
) -> Result<(), String> {
    cli::validate_id(&id)?;
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    let backups = data_dir(&app)?.join("backups");
    if scope == "user" {
        return blocking(move || settings::set_enabled(&id, Some(enabled), &backups)).await;
    }
    let dir = allowed_project(&app, project_path.as_deref().unwrap_or(""))?;
    blocking(move || {
        settings::set_enabled_in(&paths::project_settings(&dir, scope == "local"), &id, Some(enabled), &backups)
    })
    .await
}

/// 폴더별 적용 설정. value: true(켬) / false(끔) / null(PC 기본값 따름)
#[tauri::command]
async fn set_folder_enabled(
    app: AppHandle,
    id: String,
    project_path: String,
    scope: String,
    value: Option<bool>,
) -> Result<(), String> {
    cli::validate_id(&id)?;
    if scope != "project" && scope != "local" {
        return Err("폴더 범위는 project 또는 local만 가능합니다".into());
    }
    let dir = allowed_project(&app, &project_path)?;
    let backups = data_dir(&app)?.join("backups");
    blocking(move || settings::set_enabled_in(&paths::project_settings(&dir, scope == "local"), &id, value, &backups)).await
}

#[tauri::command]
async fn remove_setting(app: AppHandle, id: String) -> Result<(), String> {
    cli::validate_id(&id)?;
    let backups = data_dir(&app)?.join("backups");
    blocking(move || settings::set_enabled(&id, None, &backups)).await
}

/// 설치. scope가 project/local이면 그 폴더에서 CLI를 실행해 폴더 설정에 기록되게 한다.
#[tauri::command]
async fn install_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    accept_sha: Option<String>,
    scope: Option<String>,
    project_path: Option<String>,
) -> Result<CliResult, String> {
    cli::validate_id(&id)?;
    if let Some(s) = &accept_sha {
        if !s.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("잘못된 확인 값입니다".into());
        }
    }
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    let dir = if scope == "user" { paths::home() } else { allowed_project(&app, project_path.as_deref().unwrap_or(""))? };
    if let Ok(mut c) = state.catalog.lock() {
        *c = None;
    }
    blocking(move || {
        let mut args = vec!["plugin", "install", id.as_str(), "-s", scope.as_str(), "--json"];
        if let Some(s) = accept_sha.as_deref() {
            args.push("--accept-command");
            args.push(s);
        }
        cli::run_in(&dir, &args, Duration::from_secs(300))
    })
    .await
}

fn scoped_dir(app: &AppHandle, scope: &str, project_path: Option<&str>) -> Result<PathBuf, String> {
    if scope == "user" {
        Ok(paths::home())
    } else {
        allowed_project(app, project_path.unwrap_or(""))
    }
}

#[tauri::command]
async fn uninstall_plugin(app: AppHandle, id: String, scope: Option<String>, project_path: Option<String>) -> Result<CliResult, String> {
    cli::validate_id(&id)?;
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    let dir = scoped_dir(&app, &scope, project_path.as_deref())?;
    blocking(move || cli::run_in(&dir, &["plugin", "uninstall", &id, "-s", &scope], Duration::from_secs(120))).await
}

#[tauri::command]
async fn update_plugin(app: AppHandle, id: String, scope: Option<String>, project_path: Option<String>) -> Result<CliResult, String> {
    cli::validate_id(&id)?;
    let scope = scope.unwrap_or_else(|| "user".into());
    cli::validate_scope(&scope)?;
    let dir = scoped_dir(&app, &scope, project_path.as_deref())?;
    blocking(move || cli::run_in(&dir, &["plugin", "update", &id, "-s", &scope], Duration::from_secs(300))).await
}

#[tauri::command]
fn get_state(app: AppHandle) -> Result<HubState, String> {
    hub_state(&app)
}

#[tauri::command]
fn save_groups(app: AppHandle, groups: Vec<model::Group>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let mut st = store::load(&dir);
    st.groups = groups;
    store::save(&dir, &st)
}

#[tauri::command]
fn save_prefs(app: AppHandle, prefs: model::Prefs) -> Result<(), String> {
    if !matches!(prefs.default_install_scope.as_str(), "user" | "project" | "local") {
        return Err("알 수 없는 범위입니다".into());
    }
    let dir = data_dir(&app)?;
    let mut st = store::load(&dir);
    st.prefs = prefs;
    store::save(&dir, &st)
}

/// 작업 폴더 등록 (폴더 선택 창에서 고른 경로)
#[tauri::command]
fn add_project(app: AppHandle, path: String) -> Result<HubState, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("폴더가 아닙니다: {path}"));
    }
    if dir == paths::home() || dir.parent().is_none() {
        return Err("홈 폴더나 최상위 폴더는 등록할 수 없습니다. 작업하는 프로젝트 폴더를 고르세요.".into());
    }
    let data = data_dir(&app)?;
    let mut st = store::load(&data);
    if !st.projects.iter().any(|p| p.path == path) {
        let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
        st.projects.push(model::ProjectFolder { path: path.clone(), name });
        st.projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        store::save(&data, &st)?;
    }
    watcher::watch_project(&dir);
    Ok(st)
}

/// 폴더 등록 해제 (폴더 안의 설정 파일은 그대로 둔다)
#[tauri::command]
fn remove_project(app: AppHandle, path: String) -> Result<HubState, String> {
    let data = data_dir(&app)?;
    let mut st = store::load(&data);
    st.projects.retain(|p| p.path != path);
    if st.prefs.default_install_project.as_deref() == Some(path.as_str()) {
        st.prefs.default_install_project = None;
        st.prefs.default_install_scope = "user".into();
    }
    store::save(&data, &st)?;
    Ok(st)
}

#[tauri::command]
async fn suggest_projects() -> Result<Vec<model::ProjectFolder>, String> {
    blocking(|| Ok(scanner::suggested_projects())).await
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
        let snap = scanner::scan(&[]);
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
        let snap = scanner::scan(&[]);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let projects = app
                .path()
                .app_data_dir()
                .map(|d| store::load(&d).projects)
                .unwrap_or_default();
            watcher::start(app.handle().clone(), projects.iter().map(|p| PathBuf::from(&p.path)).collect());
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
            get_state,
            save_groups,
            save_prefs,
            add_project,
            remove_project,
            suggest_projects,
            set_folder_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
