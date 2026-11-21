use crate::paths;
use notify::{Event, RecursiveMode, Watcher};
use std::collections::HashSet;
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

pub fn watch_project(dir: &Path) {
    if let Ok(g) = control().lock() {
        if let Some(tx) = g.as_ref() {
            let _ = tx.send(Msg::AddProject(dir.to_path_buf()));
        }
    }
}

struct Targets {
    wanted: Vec<(PathBuf, RecursiveMode)>,
    watched: HashSet<PathBuf>,
}

impl Targets {
    fn add_project(&mut self, dir: &Path) {
        self.wanted.push((dir.to_path_buf(), RecursiveMode::NonRecursive));
        self.wanted.push((dir.join(".claude"), RecursiveMode::NonRecursive));
    }

    fn ensure(&mut self, w: &mut notify::RecommendedWatcher) {
        for (p, mode) in self.wanted.clone() {
            let (target, mode) = if p.is_dir() {
                (p, mode)
            } else {
                match p.ancestors().skip(1).find(|a| a.is_dir()) {
                    Some(a) => (a.to_path_buf(), RecursiveMode::NonRecursive),
                    None => continue,
                }
            };
            if self.watched.contains(&target) {
                continue;
            }
            match w.watch(&target, mode) {
                Ok(()) => {
                    self.watched.insert(target);
                }
                Err(e) => eprintln!("[watcher] {} 감시 실패: {e}", target.display()),
            }
        }
    }

    fn forget_removed(&mut self, ev: &Event) {
        if matches!(ev.kind, notify::EventKind::Remove(_)) {
            for p in &ev.paths {
                self.watched.retain(|w| !w.starts_with(p));
            }
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

        let mut targets = Targets {
            wanted: vec![
                (paths::claude_home(), RecursiveMode::NonRecursive),
                (paths::plugins_dir(), RecursiveMode::NonRecursive),
                (paths::plugins_dir().join("marketplaces"), RecursiveMode::Recursive),
                (paths::desktop_plugin_list_dir(), RecursiveMode::Recursive),
            ],
            watched: HashSet::new(),
        };
        for p in &projects {
            targets.add_project(p);
        }
        targets.ensure(&mut watcher);

        while let Ok(msg) = rx.recv() {
            let ev = match msg {
                Msg::AddProject(p) => {
                    targets.add_project(&p);
                    targets.ensure(&mut watcher);
                    continue;
                }
                Msg::Fs(ev) => ev,
            };
            targets.forget_removed(&ev);
            targets.ensure(&mut watcher);
            let mut state = matches(&ev, STATE_FILES);
            let mut catalog = matches(&ev, CATALOG_FILES);
            if !state && !catalog {
                continue;
            }
            let deadline = Instant::now() + Duration::from_millis(350);
            while let Ok(more) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                match more {
                    Msg::Fs(more) => {
                        targets.forget_removed(&more);
                        state |= matches(&more, STATE_FILES);
                        catalog |= matches(&more, CATALOG_FILES);
                    }
                    Msg::AddProject(p) => targets.add_project(&p),
                }
            }
            targets.ensure(&mut watcher);
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
