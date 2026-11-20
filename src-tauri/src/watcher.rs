//! 설정 파일 실시간 감시.
//! - 설치·켜짐 상태가 바뀌면 `hub://changed` (Claude 앱에서 추가·삭제한 경우 포함)
//! - 카탈로그(디렉터리 캐시, 마켓플레이스 목록)가 바뀌면 `hub://catalog-changed`
//! 터미널에서 `claude plugin ...`을 실행하거나 Claude 앱에서 바꿔도 화면이 바로 갱신된다.

use crate::paths;
use notify::{Event, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const STATE_FILES: &[&str] = &[
    "settings.json",
    "settings.local.json",
    "installed_plugins.json",
    "known_marketplaces.json",
    "plugins.json",
];

const CATALOG_FILES: &[&str] = &[
    "plugin-directory-cache-v2.json",
    "known_marketplaces.json",
    "marketplace.json",
];

fn matches(ev: &Event, names: &[&str]) -> bool {
    ev.paths.iter().any(|p| {
        p.file_name()
            .map(|n| names.contains(&n.to_string_lossy().as_ref()))
            .unwrap_or(false)
    })
}

enum Msg {
    Fs(Event),
    AddProject(PathBuf),
}

fn control() -> &'static Mutex<Option<mpsc::Sender<Msg>>> {
    static TX: OnceLock<Mutex<Option<mpsc::Sender<Msg>>>> = OnceLock::new();
    TX.get_or_init(|| Mutex::new(None))
}

/// 새로 등록한 폴더도 감시 대상에 넣는다.
pub fn watch_project(dir: &Path) {
    if let Ok(g) = control().lock() {
        if let Some(tx) = g.as_ref() {
            let _ = tx.send(Msg::AddProject(dir.to_path_buf()));
        }
    }
}

/// 폴더의 .claude가 있으면 그것을, 없으면 폴더 자체를 감시해 .claude가 생길 때를 잡는다.
fn watch_project_dir(w: &mut notify::RecommendedWatcher, dir: &Path) {
    let claude = dir.join(".claude");
    let target = if claude.is_dir() { claude } else { dir.to_path_buf() };
    if target.exists() {
        if let Err(e) = w.watch(&target, RecursiveMode::NonRecursive) {
            eprintln!("[watcher] {} 감시 실패: {e}", target.display());
        }
    }
}

pub fn start(app: AppHandle, projects: Vec<PathBuf>) {
    let (tx, rx) = mpsc::channel::<Msg>();
    if let Ok(mut g) = control().lock() {
        *g = Some(tx.clone());
    }
    std::thread::spawn(move || {
        let fs_tx = tx;
        let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                let _ = fs_tx.send(Msg::Fs(ev));
            }
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[watcher] 시작 실패: {e}");
                return;
            }
        };

        let targets = [
            (paths::claude_home(), RecursiveMode::NonRecursive),
            (paths::plugins_dir(), RecursiveMode::NonRecursive),
            (paths::plugins_dir().join("marketplaces"), RecursiveMode::Recursive),
            (paths::desktop_plugin_list_dir(), RecursiveMode::Recursive),
        ];
        for (p, mode) in targets {
            if p.exists() {
                if let Err(e) = watcher.watch(&p, mode) {
                    eprintln!("[watcher] {} 감시 실패: {e}", p.display());
                }
            }
        }

        for p in &projects {
            watch_project_dir(&mut watcher, p);
        }

        while let Ok(msg) = rx.recv() {
            let ev = match msg {
                Msg::AddProject(p) => {
                    watch_project_dir(&mut watcher, &p);
                    continue;
                }
                Msg::Fs(ev) => ev,
            };
            // 폴더에 .claude가 새로 생기면 그 안도 감시한다.
            for p in &ev.paths {
                if p.file_name().map(|n| n == ".claude").unwrap_or(false) && p.is_dir() {
                    let _ = watcher.watch(p, RecursiveMode::NonRecursive);
                }
            }
            let mut state = matches(&ev, STATE_FILES);
            let mut catalog = matches(&ev, CATALOG_FILES);
            if !state && !catalog {
                continue;
            }
            // 짧은 시간에 몰리는 이벤트를 한 번으로 합친다.
            let deadline = Instant::now() + Duration::from_millis(350);
            while let Ok(more) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                match more {
                    Msg::Fs(more) => {
                        state |= matches(&more, STATE_FILES);
                        catalog |= matches(&more, CATALOG_FILES);
                    }
                    Msg::AddProject(p) => watch_project_dir(&mut watcher, &p),
                }
            }
            if state {
                eprintln!("[watcher] 설치·설정 변경 감지 → 화면 갱신");
                let _ = app.emit("hub://changed", ());
            }
            if catalog {
                eprintln!("[watcher] 카탈로그 변경 감지 → 목록 갱신");
                let _ = app.emit("hub://catalog-changed", ());
            }
        }
    });
}
