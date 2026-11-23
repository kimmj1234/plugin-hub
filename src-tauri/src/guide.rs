use crate::model::{AiStatus, Guide, Plugin};
use crate::cli;
use crate::scanner::now_ms;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const README_LIMIT: usize = 6000;
/// 외부 플러그인이 넣은 설명 한 항목의 최대 길이와 전체 맥락의 최대 길이.
/// 너무 긴 프롬프트는 명령 인자 한도(약 1MB)를 넘어 실행이 실패하고, 비용만 커진다.
const FIELD_LIMIT: usize = 500;
pub const CONTEXT_LIMIT: usize = 30_000;

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

pub fn truncate(s: &str, n: usize) -> &str {
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
        truncate(&p.display_name, 100), p.id, truncate(&p.description, FIELD_LIMIT * 2)
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
            t.push_str(&format!(" — {}", truncate(&c.description, FIELD_LIMIT)));
            if !c.user_invocable {
                t.push_str(" (사용자가 직접 부를 수 없음, 자동 호출 전용)");
            }
            if !c.model_invocable {
                t.push_str(" (자동 호출 안 됨, 직접 입력 전용)");
            }
            if !c.examples.is_empty() {
                t.push_str(&format!(" / 예시 요청: {}", truncate(&c.examples.join(" | "), FIELD_LIMIT)));
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
            if let Ok(t) = crate::scanner::read_limited(&Path::new(dir).join(name), crate::scanner::MAX_README_BYTES, false) {
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
  "commands": [{"command": "/플러그인:명령 <인자>", "description": "무엇을 하는지 한 문장", "when": "이럴 때 추천: 이 명령을 쓰면 좋은 구체적인 상황 1~2문장", "usage": "어떻게 쓰는지와 인자 설명", "example": "실제 입력 예시"}],
  "tips": ["효과적으로 쓰는 요령"],
  "cautions": ["주의할 점 (훅 자동 실행, 외부 서비스 연결, 비용 등). 없으면 빈 배열"]
}
commands에는 정보에 있는 명령어와 스킬을 모두 넣는다. 정보에 명령어가 전혀 없으면 빈 배열로 둔다.

[플러그인 정보]
"#;

const COMMAND_INSTRUCTIONS: &str = r#"너는 Claude Code 플러그인의 슬래시 명령을 한국어 사용자에게 설명하는 안내서 작성자다.
아래 명령 목록만 근거로, 각 명령을 처음 보는 사람이 "언제 이걸 쓰면 되는지" 바로 알 수 있게 설명한다.
정보에 없는 기능을 지어내지 않는다. 명령어 이름, 인자, 코드, 파일 이름은 원문 그대로 둔다.
반드시 아래 형식의 JSON 하나만 출력한다. 다른 말이나 코드 블록 표시는 쓰지 않는다.
{
  "commands": [{
    "command": "/플러그인:명령 <인자>",
    "description": "무엇을 하는지 한 문장 (쉬운 한국어)",
    "when": "이럴 때 추천: 이 명령을 쓰면 좋은 구체적인 상황 1~2문장. 비슷한 명령이 목록에 있으면 무엇과 어떻게 다른지도 짧게",
    "usage": "어떻게 쓰는지. 인자가 있으면 각 인자가 무엇인지",
    "example": "실제로 입력할 한 줄 예시 (명령으로 시작)"
  }]
}
목록에 있는 명령을 하나도 빠뜨리지 말고, 목록 순서대로 모두 넣는다.

[명령 목록]
"#;

/// 명령 일부만 골라 한국어 설명을 만든다. 명령이 많은 플러그인은 한 번에 만들면 답이 잘리거나 오래 걸려서
/// 화면에서 여러 번 나눠 부른다. 결과는 저장된 가이드에 합쳐서 다시 쓴다.
pub fn command_context(p: &Plugin, names: &[String]) -> String {
    let mut s = format!(
        "플러그인 이름: {}\n플러그인 설명: {}\n",
        truncate(&p.display_name, 100),
        truncate(&p.description, FIELD_LIMIT)
    );
    // 비슷한 명령과 비교할 수 있게 전체 명령 이름도 짧게 알려 준다
    let all: Vec<&str> = p.components.commands.iter().chain(&p.components.skills).map(|c| c.name.as_str()).collect();
    s.push_str(&format!("이 플러그인의 전체 명령 이름: {}\n\n", truncate(&all.join(", "), 4000)));
    let ns = if p.display_name.is_empty() { &p.name } else { &p.display_name };
    for c in p.components.commands.iter().chain(&p.components.skills) {
        if !names.iter().any(|n| n == &c.name) {
            continue;
        }
        s.push_str(&format!("- /{ns}:{}", c.name));
        if let Some(h) = &c.argument_hint {
            s.push_str(&format!(" {}", truncate(h, 200)));
        }
        s.push_str(&format!(" — {}", truncate(&c.description, FIELD_LIMIT * 2)));
        if !c.examples.is_empty() {
            s.push_str(&format!(" / 예시 요청: {}", truncate(&c.examples.join(" | "), FIELD_LIMIT)));
        }
        s.push('\n');
    }
    s
}

/// 가이드의 명령 이름("/plugin:cmd <인자>")에서 비교용 키(cmd)를 뽑는다.
pub fn command_key(s: &str) -> String {
    let first = s.split_whitespace().next().unwrap_or("");
    first.trim_start_matches('/').rsplit(':').next().unwrap_or("").to_lowercase()
}

/// 새로 만든 명령 설명을 기존 목록에 합친다. 같은 명령은 새 것으로 바꾸고, 기존에만 있는 것은 남긴다.
pub fn merge_commands(old: &[crate::model::GuideCommand], new: Vec<crate::model::GuideCommand>) -> Vec<crate::model::GuideCommand> {
    let mut out = new;
    for o in old {
        if !out.iter().any(|n| command_key(&n.command) == command_key(&o.command)) {
            out.push(o.clone());
        }
    }
    out
}

pub fn generate_commands(dir: &Path, p: &Plugin, names: &[String]) -> Result<Guide, String> {
    let context = command_context(p, names);
    let v = ask(dir, &format!("{COMMAND_INSTRUCTIONS}{}", truncate(&context, CONTEXT_LIMIT)))?;
    let cmds: Vec<crate::model::GuideCommand> = serde_json::from_value(v.get("commands").cloned().unwrap_or(Value::Array(vec![])))
        .map_err(|e| format!("명령 설명 형식 오류: {e}"))?;
    if cmds.is_empty() {
        return Err("명령 설명을 만들지 못했습니다. 다시 시도해 주세요.".into());
    }
    let version = p.version.as_deref();
    let mut g = cached(dir, &p.id, version).unwrap_or_default();
    g.commands = merge_commands(&g.commands, cmds);
    if g.generated_at == 0 {
        g.generated_at = now_ms();
    }
    g.version = version.map(String::from);
    save(dir, &p.id, version, &g)?;
    Ok(g)
}

fn save(dir: &Path, id: &str, version: Option<&str>, g: &Guide) -> Result<(), String> {
    let f = cache_file(dir, id, version);
    fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&f, serde_json::to_string_pretty(g).unwrap_or_default()).map_err(|e| e.to_string())
}

/// 모델 응답에서 JSON 객체 부분만 꺼낸다. 응답은 외부 플러그인 글에 영향을 받을 수 있으므로
/// 순서가 뒤집힌 괄호("} … {")처럼 이상한 출력이어도 패닉 없이 None을 돌려준다.
/// (릴리스 빌드는 panic = "abort"라서 패닉 하나가 앱 전체를 끈다)
pub fn extract_json(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = start + text.get(start..)?.rfind('}')?;
    serde_json::from_str(text.get(start..=end)?).ok()
}

/// Claude Code를 도구 없이 실행해 JSON 답을 받는다.
fn ask(dir: &Path, prompt: &str) -> Result<Value, String> {
    let work = dir.join("guide-workdir");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    // 프롬프트는 표준 입력으로 넘긴다 (Windows 명령줄 길이·배치 파일 인자 제한 회피)
    let r = cli::run_in_with_input(
        &work,
        &[
            "-p",
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
        prompt,
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
    extract_json(result).ok_or_else(|| "가이드 형식을 해석하지 못했습니다. 다시 시도해 주세요.".into())
}

pub fn generate(dir: &Path, id: &str, version: Option<&str>, context: &str) -> Result<Guide, String> {
    let v = ask(dir, &format!("{INSTRUCTIONS}{}", truncate(context, CONTEXT_LIMIT)))?;
    let mut g: Guide = serde_json::from_value(v).map_err(|e| format!("가이드 형식 오류: {e}"))?;
    // 명령별로 따로 만들어 둔 설명이 있으면 지우지 않고 합친다 (명령이 많으면 전체 가이드에 다 담기지 않는다)
    if let Some(old) = cached(dir, id, version) {
        g.commands = merge_commands(&old.commands, std::mem::take(&mut g.commands));
    }
    g.generated_at = now_ms();
    g.version = version.map(String::from);
    save(dir, id, version, &g)?;
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
    #[cfg(windows)]
    {
        // 새 콘솔 창에서 공식 로그인 명령을 실행한다. 경로는 앱이 찾은 Claude Code 실행 파일만 쓴다.
        // .exe는 cmd를 거치지 않고 직접 띄워 경로에 &, ^, % 같은 문자가 있어도 해석되지 않게 한다.
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        let is_exe = cli.path.to_ascii_lowercase().ends_with(".exe");
        let mut cmd = if is_exe {
            let mut c = std::process::Command::new(&cli.path);
            c.args(["auth", "login"]);
            c
        } else {
            // npm 설치의 claude.cmd는 cmd로만 실행할 수 있다. 위험한 문자가 있으면 거부한다.
            if cli.path.chars().any(|ch| matches!(ch, '&' | '|' | '^' | '%' | '<' | '>' | '"' | '(' | ')')) {
                return Err("Claude Code 경로에 특수 문자가 있어 로그인 창을 열지 않았습니다. 터미널에서 `claude auth login`을 실행하세요.".into());
            }
            let mut c = std::process::Command::new("cmd");
            c.arg("/K").arg(&cli.path).args(["auth", "login"]);
            c
        };
        cmd.creation_flags(CREATE_NEW_CONSOLE).spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = cli;
        Err("이 OS에서는 아직 지원하지 않습니다. 터미널에서 `claude auth login`을 실행하세요.".into())
    }
}
