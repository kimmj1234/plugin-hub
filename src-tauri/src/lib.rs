mod catalog;
mod claude_app;
mod cli;
mod guide;
#[cfg(target_os = "macos")]
mod mac_ax;
mod model;
mod orphan;
mod paths;
mod rules;
mod scanner;
mod settings;
mod store;
mod usage;
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
    store::load(&data_dir(app)?)
}

fn allowed_project(app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let registered = hub_state(app)?.projects.iter().any(|p| p.path == path);
    let dir = PathBuf::from(path);
    if !dir.is_absolute() || !(registered || scanner::recorded_project_paths().iter().any(|p| p == path)) {
        return Err("등록되지 않은 폴더입니다. '적용 범위'에서 먼저 폴더를 추가하세요.".into());
    }
    if !dir.is_dir() {
        return Err(format!("폴더를 찾을 수 없습니다: {path}\n옮겨졌거나 삭제되었거나, 외장 디스크·네트워크 폴더가 연결되지 않았을 수 있습니다. 삭제된 폴더라면 이 폴더에 설치한 플러그인은 '설치 기록 정리'로 정리할 수 있습니다."));
    }
    // 설치 기록(installed_plugins.json)에서 온 경로도 시스템·민감 폴더면 쓰지 않는다
    if let Some(reason) = paths::forbidden_project(&paths::canonical(&dir).unwrap_or_else(|_| dir.clone())) {
        return Err(reason.into());
    }
    Ok(dir)
}

#[tauri::command]
async fn scan(app: AppHandle) -> Result<Snapshot, String> {
    let projects = hub_state(&app)?.projects;
    let mut snap = blocking(move || Ok(scanner::scan(&projects))).await?;
    use std::sync::atomic::Ordering;
    snap.watcher_ok = WATCHER_STARTED.load(Ordering::SeqCst) && !watcher::FAILED.load(Ordering::SeqCst);
    Ok(snap)
}

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
        settings::set_enabled_in(&settings::project_settings_checked(&dir, scope == "local")?, &id, Some(enabled), &backups)
    })
    .await
}

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
    blocking(move || settings::set_enabled_in(&settings::project_settings_checked(&dir, scope == "local")?, &id, value, &backups)).await
}

#[tauri::command]
async fn remove_setting(app: AppHandle, id: String) -> Result<(), String> {
    cli::validate_id(&id)?;
    let backups = data_dir(&app)?.join("backups");
    blocking(move || settings::set_enabled(&id, None, &backups)).await
}

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
    if let Some(s) = &accept_sha
        && (s.is_empty() || !s.chars().all(|c| c.is_ascii_hexdigit())) {
            return Err("잘못된 확인 값입니다".into());
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
    // 폴더 범위로 설치한 뒤 그 폴더가 삭제된 경우: 공식 명령은 그 폴더 안에서만 삭제할 수 있으므로
    // 같은 경로에 빈 폴더를 잠깐 만들어 실행하고 지운다. 설치 기록에 적힌 경로만 허용한다.
    if scope != "user" {
        let path = project_path.clone().unwrap_or_default();
        let dir = PathBuf::from(&path);
        if orphan::deletion_plausible(&dir) && scanner::recorded_project_paths().iter().any(|p| p == &path) {
            if let Some(reason) = paths::forbidden_project(&dir) {
                return Err(reason.into());
            }
            return blocking(move || {
                let (mut r, removed) = orphan::with_temp_folder(&dir, |d| {
                    cli::run_in(d, &["plugin", "uninstall", &id, "-s", &scope], Duration::from_secs(120))
                })?;
                if !removed {
                    r.warning = Some(format!("정리에 쓴 임시 폴더를 지우지 못했습니다(그 사이 다른 파일이 생겼거나 사용 중). 필요 없으면 직접 지우세요: {path}"));
                }
                Ok(r)
            })
            .await;
        }
    }
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
    let mut st = store::load(&dir)?;
    st.groups = groups;
    store::save(&dir, &st)
}

#[tauri::command]
fn save_prefs(app: AppHandle, prefs: model::Prefs) -> Result<(), String> {
    if !matches!(prefs.default_install_scope.as_str(), "user" | "project" | "local") {
        return Err("알 수 없는 범위입니다".into());
    }
    if !matches!(prefs.app_update.as_str(), "auto" | "notify" | "off") {
        return Err("알 수 없는 업데이트 방식입니다".into());
    }
    let dir = data_dir(&app)?;
    let mut st = store::load(&dir)?;
    // 로그인 시 실행은 먼저 실제로 바꿔 보고, 성공했을 때만 저장한다. 실패했는데 켜짐으로 저장되면
    // 화면과 실제가 어긋나고, 다음 저장 때는 "바뀐 것 없음"으로 보여 다시 시도하지도 않는다.
    if st.prefs.launch_at_login != prefs.launch_at_login {
        apply_launch_at_login(&app, prefs.launch_at_login)?;
    }
    st.prefs = prefs;
    store::save(&dir, &st)?;
    if consented(&st.prefs) {
        start_watcher_once(&app, &st.projects);
    }
    Ok(())
}

fn apply_launch_at_login(app: &AppHandle, on: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    let now = al.is_enabled().unwrap_or(false);
    if on && !now {
        al.enable().map_err(|e| format!("로그인 시 실행을 켜지 못했습니다: {e}"))?;
    } else if !on && now {
        al.disable().map_err(|e| format!("로그인 시 실행을 끄지 못했습니다: {e}"))?;
    }
    Ok(())
}

const HIDDEN_ARG: &str = "--hidden";
/// 개인정보 안내문 버전 (프론트엔드 hub.tsx의 PRIVACY_VERSION과 같아야 한다)
const PRIVACY_VERSION: u32 = 1;
static WATCHER_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn consented(prefs: &model::Prefs) -> bool {
    prefs.onboarding_done && prefs.privacy_ack >= PRIVACY_VERSION
}

/// 파일 감시는 사용자가 개인정보 안내에 동의한 뒤에만 시작한다 (한 번만)
fn start_watcher_once(app: &AppHandle, projects: &[model::ProjectFolder]) {
    use std::sync::atomic::Ordering;
    // 처음이거나, 이전 시작이 실패했으면 다시 시도한다
    if !WATCHER_STARTED.swap(true, Ordering::SeqCst) || watcher::FAILED.swap(false, Ordering::SeqCst) {
        watcher::start(app.clone(), projects.iter().map(|p| PathBuf::from(&p.path)).collect());
    }
}

/// 트레이(메뉴 막대) 아이콘: 창을 닫아도 뒤에서 도는 앱이라, 다시 열기와 완전 종료를 여기서 한다.
/// Windows에는 ⌘Q가 없어서 이 메뉴가 유일한 종료 방법이다.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Plugin Hub 열기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Plugin Hub 종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Plugin Hub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
fn add_project(app: AppHandle, path: String) -> Result<HubState, String> {
    let raw = PathBuf::from(&path);
    if !raw.is_absolute() || !raw.is_dir() {
        return Err(format!("폴더가 아닙니다: {path}"));
    }
    let dir = paths::canonical(&raw).map_err(|e| format!("폴더를 확인하지 못했습니다: {e}"))?;
    if let Some(reason) = paths::forbidden_project(&dir) {
        return Err(reason.into());
    }
    let path = dir.to_string_lossy().to_string();
    let data = data_dir(&app)?;
    let mut st = store::load(&data)?;
    if !st.projects.iter().any(|p| p.path == path) {
        let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
        st.projects.push(model::ProjectFolder { path: path.clone(), name });
        st.projects.sort_by_key(|a| a.name.to_lowercase());
        store::save(&data, &st)?;
    }
    watcher::watch_project(&dir);
    Ok(st)
}

#[tauri::command]
fn remove_project(app: AppHandle, path: String) -> Result<HubState, String> {
    let data = data_dir(&app)?;
    let mut st = store::load(&data)?;
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

/// 마켓플레이스 주소 허용 목록. Windows에서는 명령이 cmd.exe를 거칠 수 있어 `%` 같은 문자를 막는다.
pub(crate) fn valid_marketplace_source(v: &str) -> bool {
    if v.is_empty() || v.len() > 300 || v.starts_with('-') || v.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '%' | '"' | '&' | '|' | '^' | '<' | '>' | '`' | '$' | ';')) {
        return false;
    }
    let trimmed = v.strip_suffix(".git").unwrap_or(v);
    if claude_app::valid_marketplace(trimmed) {
        return true;
    }
    // git@github.com:owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("git@") {
        let safe = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.');
        if let Some((host, path)) = rest.split_once(':') {
            return !host.is_empty() && host.chars().all(safe) && path.split('/').count() == 2 && path.split('/').all(|seg| !seg.is_empty() && seg != ".." && seg.chars().all(safe));
        }
        return false;
    }
    // 이 PC의 마켓플레이스 폴더
    let p = std::path::Path::new(v);
    p.is_absolute() && p.is_dir()
}

#[tauri::command]
async fn add_marketplace(state: State<'_, AppState>, source: String) -> Result<CliResult, String> {
    let source = source.trim().to_string();
    if !valid_marketplace_source(&source) {
        return Err("마켓플레이스 주소 형식이 올바르지 않습니다. GitHub 저장소(owner/repo), https 주소, git@ 주소, 또는 이 PC의 폴더 경로를 입력하세요.".into());
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
    if !refresh
        && let Ok(c) = state.catalog.lock()
            && let Some(cat) = c.as_ref()
                && scanner::now_ms().saturating_sub(cat.fetched_at) < CATALOG_TTL_MS {
                    return Ok(cat.clone());
                }
    let dir = data_dir(&app)?;
    let cat = blocking(move || catalog::load(&dir)).await?;
    if let Ok(mut c) = state.catalog.lock() {
        *c = Some(cat.clone());
    }
    Ok(cat)
}

#[tauri::command]
async fn update_marketplaces(state: State<'_, AppState>) -> Result<String, String> {
    let r = blocking(catalog::update_marketplaces).await;
    if let Ok(mut c) = state.catalog.lock() {
        *c = None;
    }
    r
}

#[tauri::command]
async fn get_usage(app: AppHandle, names: Vec<String>, days: u32) -> Result<usage::UsageReport, String> {
    // 대화 기록은 사용자가 동의했을 때만 읽는다
    if !hub_state(&app)?.prefs.usage_consent {
        return Err("사용 분석에 동의하지 않았습니다. 설정에서 켤 수 있습니다.".into());
    }
    if names.len() > 500 || names.iter().any(|n| n.is_empty() || n.len() > 128) {
        return Err("잘못된 플러그인 이름입니다".into());
    }
    let days = days.clamp(1, 365);
    blocking(move || Ok(usage::scan(&names, days))).await
}

#[tauri::command]
async fn ai_status() -> Result<AiStatus, String> {
    blocking(|| Ok(guide::status())).await
}

#[tauri::command]
async fn install_in_claude_app(name: String, repo: Option<String>) -> Result<String, String> {
    blocking(move || claude_app::auto_install(&name, repo.as_deref())).await
}

#[tauri::command]
async fn permissions() -> Result<model::Permissions, String> {
    blocking(|| {
        Ok(model::Permissions {
            os: std::env::consts::OS.into(),
            #[cfg(target_os = "macos")]
            accessibility: Some(mac_ax::trusted(false)),
            #[cfg(not(target_os = "macos"))]
            accessibility: None,
            cli: cli::active_cli(),
            desktop_installed: paths::desktop_installed(),
            claude_home_exists: paths::claude_home().exists(),
        })
    })
    .await
}

/// macOS 손쉬운 사용 권한을 요청한다. 시스템이 Plugin Hub를 목록에 올리고 허용 창을 띄운다.
/// 권한은 앱이 스스로 켤 수 없어서(운영체제 보안 정책) 사용자가 설정에서 직접 켜야 한다.
#[tauri::command]
fn request_accessibility() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        if mac_ax::trusted(true) {
            return Ok(true);
        }
        let _ = claude_app::open_accessibility_settings();
        Ok(false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(true)
    }
}

/// 앱에 포함된 오픈소스 라이선스 전문(THIRD_PARTY_LICENSES.txt)을 기본 텍스트 편집기로 연다
#[tauri::command]
fn open_licenses(app: AppHandle) -> Result<(), String> {
    let p = app
        .path()
        .resolve("THIRD_PARTY_LICENSES.txt", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !p.is_file() {
        return Err("라이선스 파일을 찾지 못했습니다.".into());
    }
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| format!("파일을 열지 못했습니다: {e}"))
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    claude_app::open_accessibility_settings()
}

#[tauri::command]
fn open_in_claude_app(kind: String, value: Option<String>, plugin: Option<String>) -> Result<(), String> {
    claude_app::open(&kind, value.as_deref(), plugin.as_deref())
}

#[tauri::command]
async fn open_login() -> Result<(), String> {
    // CLI 버전 확인이 최대 10초 걸릴 수 있어 화면이 멈추지 않게 뒤에서 실행한다
    blocking(guide::open_login_terminal).await
}

#[tauri::command]
fn get_guide(app: AppHandle, id: String, version: Option<String>) -> Result<Option<Guide>, String> {
    Ok(guide::cached(&data_dir(&app)?, &id, version.as_deref()))
}

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
                    guide::truncate(name.as_deref().unwrap_or(&id), 100),
                    guide::truncate(description.as_deref().unwrap_or_default(), 2000)
                ),
                version,
            ),
        };
        guide::generate(&dir, &id, ver.as_deref(), &context)
    })
    .await
}

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
            if let Ok(text) = scanner::read_limited(&f, scanner::MAX_README_BYTES, false) {
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
        // 이미 실행 중이면 새로 띄우지 않고 기존 창을 보여 준다 (창을 닫아도 뒤에서 도는 앱이라 Windows에서 특히 필요)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_ARG]),
        ))
        .manage(AppState::default())
        .setup(|app| {
            let state = app.path().app_data_dir().ok().and_then(|d| store::load(&d).ok()).unwrap_or_default();
            // 로그인 항목을 설정값과 맞춘다 (앱을 옮기거나 다시 설치해도 경로가 최신이 되도록).
            if let Err(e) = apply_launch_at_login(app.handle(), state.prefs.launch_at_login) {
                eprintln!("[autostart] {e}");
            }
            if !std::env::args().any(|a| a == HIDDEN_ARG) {
                show_main(app.handle());
            }
            if consented(&state.prefs) {
                start_watcher_once(app.handle(), &state.projects);
            }
            if let Err(e) = build_tray(app) {
                eprintln!("[tray] {e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 창을 닫아도 앱은 계속 실행해 감시·자동 업데이트를 이어 간다. 완전히 끄려면 트레이 메뉴의 종료(macOS는 ⌘Q도 가능).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
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
            open_in_claude_app,
            install_in_claude_app,
            open_accessibility_settings,
            get_guide,
            generate_guide,
            read_readme,
            get_state,
            save_groups,
            save_prefs,
            add_project,
            remove_project,
            suggest_projects,
            set_folder_enabled,
            get_usage,
            permissions,
            request_accessibility,
            open_licenses
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main(app);
            }
            let _ = (app, event);
        });
}
