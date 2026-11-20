//! 설정 파일 실시간 감시.
//! - 설치·켜짐 상태가 바뀌면 `hub://changed` (Claude 앱에서 추가·삭제한 경우 포함)
//! - 카탈로그(디렉터리 캐시, 마켓플레이스 목록)가 바뀌면 `hub://catalog-changed`
//! 터미널에서 `claude plugin ...`을 실행하거나 Claude 앱에서 바꿔도 화면이 바로 갱신된다.

use crate::paths;
use notify::{Event, RecursiveMode, Watcher};
use std::sync::mpsc;
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

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<Event>();
        let mut watcher = match notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                let _ = tx.send(ev);
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

        while let Ok(ev) = rx.recv() {
            let mut state = matches(&ev, STATE_FILES);
            let mut catalog = matches(&ev, CATALOG_FILES);
            if !state && !catalog {
                continue;
            }
            // 짧은 시간에 몰리는 이벤트를 한 번으로 합친다.
            let deadline = Instant::now() + Duration::from_millis(350);
            while let Ok(more) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                state |= matches(&more, STATE_FILES);
                catalog |= matches(&more, CATALOG_FILES);
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
