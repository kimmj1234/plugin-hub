//! 설정 파일 실시간 감시. 바뀌면 프론트엔드에 `hub://changed` 이벤트를 보낸다.
//! 터미널에서 `claude plugin ...`을 실행하거나 설정을 직접 고쳐도 화면과 진단이 바로 갱신된다.

use crate::paths;
use notify::{Event, RecursiveMode, Watcher};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const WATCHED_FILES: &[&str] = &[
    "settings.json",
    "settings.local.json",
    "installed_plugins.json",
    "known_marketplaces.json",
    "plugins.json",
];

fn relevant(ev: &Event) -> bool {
    ev.paths.iter().any(|p| {
        p.file_name()
            .map(|n| WATCHED_FILES.contains(&n.to_string_lossy().as_ref()))
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
            if !relevant(&ev) {
                continue;
            }
            // 짧은 시간에 몰리는 이벤트를 한 번으로 합친다.
            let deadline = Instant::now() + Duration::from_millis(350);
            while rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .is_ok()
            {}
            eprintln!("[watcher] 설정 변경 감지 → 화면 갱신");
            let _ = app.emit("hub://changed", ());
        }
    });
}
