use crate::model::{AiStatus, Guide, Plugin};
use crate::cli;
use crate::scanner::now_ms;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const README_LIMIT: usize = 6000;

fn cache_file(dir: &Path, id: &str, version: Option<&str>) -> PathBuf {
    let safe: String = format!("{id}-{}", version.unwrap_or("na"))
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' { c } else { '_' })
        .collect();
    dir.join("guides").join(format!("{safe}.json"))
}

pub fn cached(dir: &Path, id: &str, version: Option<&str>) -> Option<Guide> {
    let text = fs::read_to_string(cache_file(dir, id, version)).ok()?;
    serde_json::from_str(&text).ok()
}

pub fn status() -> AiStatus {
    let Some(_) = cli::active_cli() else {
        return AiStatus {
            cli_found: false,
            logged_in: false,
            detail: "Claude Code CLI를 찾지 못했습니다.".into(),
        };
    };
    match cli::run(&["auth", "status", "--json"], Duration::from_secs(15)) {
        Ok(r) => {
            let v: Value = serde_json::from_str(r.stdout.trim()).unwrap_or(Value::Null);
            let logged = v.get("loggedIn").and_then(|x| x.as_bool()).unwrap_or(false);
            AiStatus {
                cli_found: true,
                logged_in: logged,
                detail: if logged {
                    "로그인됨".into()
                } else {
                    "Claude Code CLI에 로그인되어 있지 않습니다.".into()
                },
            }
        }
        Err(e) => AiStatus {
            cli_found: true,
            logged_in: false,
            detail: e,
        },
    }
}

fn truncate(s: &str, n: usize) -> &str {
    if s.len() <= n {
        return s;
    }
    let mut cut = n;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    &s[..cut]
}

pub fn context_from_plugin(p: &Plugin) -> String {
    let mut s = format!(
        "플러그인 이름: {}\n식별자: {}\n설명: {}\n",
        p.display_name, p.id, p.description
    );
    let section = |title: &str, items: &[crate::model::Component], slash: bool| -> String {
        if items.is_empty() {
            return String::new();
        }
        let mut t = format!("\n[{title}]\n");
        for c in items {
            let call = if slash { format!("/{}:{}", p.name, c.name) } else { c.name.clone() };
            t.push_str(&format!("- {call}"));
            if let Some(h) = &c.argument_hint {
                t.push_str(&format!(" {h}"));
            }
            t.push_str(&format!(" — {}", c.description));
            if !c.user_invocable {
                t.push_str(" (사용자가 직접 부를 수 없음, 자동 호출 전용)");
            }
            if !c.model_invocable {
                t.push_str(" (자동 호출 안 됨, 직접 입력 전용)");
            }
            if !c.examples.is_empty() {
                t.push_str(&format!(" / 예시 요청: {}", c.examples.join(" | ")));
            }
            t.push('\n');
        }
        t
    };
    s.push_str(&section("명령어", &p.components.commands, true));
    s.push_str(&section("스킬", &p.components.skills, true));
    s.push_str(&section("에이전트", &p.components.agents, false));
    if !p.components.hooks.is_empty() {
        s.push_str(&format!("\n[자동 실행 훅] {}\n", p.components.hooks.join(", ")));
    }
    if !p.components.mcp_servers.is_empty() {
        s.push_str(&format!("\n[MCP 서버] {}\n", p.components.mcp_servers.join(", ")));
    }
    if let Some(dir) = &p.install_path {
        for name in ["README.md", "readme.md"] {
            if let Ok(t) = fs::read_to_string(Path::new(dir).join(name)) {
                s.push_str(&format!("\n[README 앞부분]\n{}\n", truncate(&t, README_LIMIT)));
                break;
            }
        }
    }
    s
}

const INSTRUCTIONS: &str = r#"너는 Claude Code 플러그인을 한국어 사용자에게 설명하는 안내서 작성자다.
아래 플러그인 정보만 근거로, 처음 쓰는 사람이 바로 따라 할 수 있는 한국어 가이드를 만든다.
정보에 없는 명령어나 기능을 지어내지 않는다. 명령어 이름, 인자, 코드는 원문 그대로 둔다.
반드시 아래 형식의 JSON 하나만 출력한다. 다른 말이나 코드 블록 표시는 쓰지 않는다.
{
  "summary": "이 플러그인이 무엇이고 언제 쓰는지 2~3문장",
  "useCases": ["이럴 때 쓰세요 형태의 구체적 상황 3~5개"],
  "commands": [{"command": "/플러그인:명령 <인자>", "description": "무엇을 하는지", "usage": "언제·어떻게 쓰는지와 인자 설명", "example": "실제 입력 예시"}],
  "tips": ["효과적으로 쓰는 요령"],
  "cautions": ["주의할 점 (훅 자동 실행, 외부 서비스 연결, 비용 등). 없으면 빈 배열"]
}
commands에는 정보에 있는 명령어와 스킬을 모두 넣는다. 정보에 명령어가 전혀 없으면 빈 배열로 둔다.

[플러그인 정보]
"#;

fn extract_json(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str(&text[start..=end]).ok()
}

pub fn generate(dir: &Path, id: &str, version: Option<&str>, context: &str) -> Result<Guide, String> {
    let work = dir.join("guide-workdir");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let prompt = format!("{INSTRUCTIONS}{context}");
    let r = cli::run_in(
        &work,
        &[
            "-p",
            &prompt,
            "--output-format",
            "json",
            "--tools",
            "",
            "--no-session-persistence",
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--setting-sources",
            "project",
            "--model",
            "sonnet",
        ],
        Duration::from_secs(240),
    )?;
    let outer: Value = serde_json::from_str(r.stdout.trim())
        .map_err(|_| format!("Claude 응답을 읽지 못했습니다: {}", r.stderr.trim()))?;
    let result = outer.get("result").and_then(|x| x.as_str()).unwrap_or("");
    if outer.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false) || !r.ok {
        return Err(if result.contains("Not logged in") {
            "Claude Code에 로그인되어 있지 않습니다. 로그인 후 다시 시도하세요.".into()
        } else {
            format!("가이드 생성 실패: {result}")
        });
    }
    let v = extract_json(result).ok_or("가이드 형식을 해석하지 못했습니다. 다시 시도해 주세요.")?;
    let mut g: Guide = serde_json::from_value(v).map_err(|e| format!("가이드 형식 오류: {e}"))?;
    g.generated_at = now_ms();
    g.version = version.map(String::from);
    let f = cache_file(dir, id, version);
    fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&f, serde_json::to_string_pretty(&g).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(g)
}

pub fn open_login_terminal() -> Result<(), String> {
    let cli = cli::active_cli().ok_or("Claude Code CLI를 찾지 못했습니다.")?;
    #[cfg(target_os = "macos")]
    {
        let script_path = std::env::temp_dir().join("plugin-hub-claude-login.command");
        let quoted = cli.path.replace('\'', "'\\''");
        fs::write(
            &script_path,
            format!("#!/bin/sh\necho 'Claude Code 로그인을 시작합니다. 브라우저 안내를 따라 주세요.'\n'{quoted}' auth login\necho\necho '완료되면 이 창을 닫고 Plugin Hub로 돌아가세요.'\n"),
        )
        .map_err(|e| e.to_string())?;
        std::process::Command::new("chmod").arg("+x").arg(&script_path).status().map_err(|e| e.to_string())?;
        std::process::Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&script_path)
            .status()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = cli;
        Err("이 OS에서는 아직 지원하지 않습니다. 터미널에서 `claude auth login`을 실행하세요.".into())
    }
}
