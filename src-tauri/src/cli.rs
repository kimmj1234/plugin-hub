//! 공식 `claude plugin` CLI 호출.
//! 설치·삭제·업데이트처럼 캐시와 마켓플레이스를 함께 다루는 작업은 직접 구현하지 않고 CLI에 맡긴다.

use crate::model::{AcceptPrompt, CliInfo, CliResult};
use crate::paths;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

fn version_cache() -> &'static Mutex<HashMap<PathBuf, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cli_version(path: &Path) -> Option<String> {
    if let Some(v) = version_cache().lock().ok()?.get(path) {
        return v.clone();
    }
    let v = run_raw(path, &["--version"], Duration::from_secs(10))
        .ok()
        .filter(|r| r.ok)
        .map(|r| r.stdout.split_whitespace().next().unwrap_or("").to_string())
        .filter(|s| !s.is_empty());
    if let Ok(mut c) = version_cache().lock() {
        c.insert(path.to_path_buf(), v.clone());
    }
    v
}

pub fn find_terminal_cli() -> Option<CliInfo> {
    let path = paths::terminal_cli_candidates().into_iter().find(|p| p.is_file())?;
    Some(CliInfo {
        version: cli_version(&path),
        path: path.to_string_lossy().to_string(),
        kind: "terminal".into(),
    })
}

pub fn find_bundled_cli() -> Option<CliInfo> {
    let (ver, path) = paths::bundled_cli_versions().into_iter().next()?;
    Some(CliInfo {
        path: path.to_string_lossy().to_string(),
        version: Some(ver),
        kind: "desktop-bundled".into(),
    })
}

/// 명령 실행에 쓸 CLI. 터미널 CLI를 우선하고, 없으면 Claude 앱 내장 CLI를 쓴다.
/// 둘 다 같은 ~/.claude 설정을 사용한다.
pub fn active_cli() -> Option<CliInfo> {
    find_terminal_cli().or_else(find_bundled_cli)
}

fn run_raw(bin: &Path, args: &[&str], timeout: Duration) -> Result<CliResult, String> {
    run_raw_in(bin, &paths::home(), args, timeout)
}

fn run_raw_in(bin: &Path, cwd: &Path, args: &[&str], timeout: Duration) -> Result<CliResult, String> {
    let mut child = Command::new(bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", paths::child_path())
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("CLI 실행 실패: {e}"))?;

    // 출력이 파이프 버퍼를 넘쳐 막히지 않도록 별도 스레드에서 읽는다.
    let mut so = child.stdout.take().unwrap();
    let mut se = child.stderr.take().unwrap();
    let t_out = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = so.read_to_string(&mut s);
        s
    });
    let t_err = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = se.read_to_string(&mut s);
        s
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break Some(st),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let stdout = t_out.join().unwrap_or_default();
    let mut stderr = t_err.join().unwrap_or_default();
    if status.is_none() {
        stderr.push_str(&format!("\n시간 초과({}초)로 중단했습니다.", timeout.as_secs()));
    }
    let code = status.and_then(|s| s.code());
    let ok = status.map(|s| s.success()).unwrap_or(false);
    let needs_accept = find_accept_prompt(&stdout);
    Ok(CliResult {
        ok,
        code,
        stdout,
        stderr,
        needs_accept,
    })
}

pub fn run(args: &[&str], timeout: Duration) -> Result<CliResult, String> {
    let cli = active_cli().ok_or_else(|| {
        "Claude Code CLI를 찾지 못했습니다. 터미널용 Claude Code를 설치하거나 Claude 앱을 설치해 주세요."
            .to_string()
    })?;
    run_raw(Path::new(&cli.path), args, timeout)
}

/// 작업 폴더를 지정해 실행한다 (가이드 생성처럼 사용자 프로젝트 설정을 피해야 할 때).
pub fn run_in(cwd: &Path, args: &[&str], timeout: Duration) -> Result<CliResult, String> {
    let cli = active_cli().ok_or_else(|| "Claude Code CLI를 찾지 못했습니다.".to_string())?;
    run_raw_in(Path::new(&cli.path), cwd, args, timeout)
}

/// `--json` 출력에서 사용자 확인이 필요한 명령(shownCommand)을 찾는다.
fn find_accept_prompt(stdout: &str) -> Option<AcceptPrompt> {
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if let Some(sc) = find_key(&v, "shownCommand") {
            let sha = sc.get("sha256").and_then(|s| s.as_str())?.to_string();
            return Some(AcceptPrompt {
                sha256: sha,
                detail: serde_json::to_string_pretty(sc).unwrap_or_default(),
            });
        }
    }
    None
}

fn find_key<'a>(v: &'a Value, key: &str) -> Option<&'a Value> {
    match v {
        Value::Object(m) => {
            if let Some(x) = m.get(key) {
                return Some(x);
            }
            m.values().find_map(|x| find_key(x, key))
        }
        Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

/// 플러그인 id(name@marketplace)로 쓸 수 있는 문자만 허용한다. 인자 주입 방지.
pub fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.@:/".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("허용되지 않는 플러그인 이름입니다: {id}"))
    }
}

pub fn validate_scope(scope: &str) -> Result<(), String> {
    match scope {
        "user" | "project" | "local" => Ok(()),
        _ => Err(format!("알 수 없는 범위입니다: {scope}")),
    }
}
