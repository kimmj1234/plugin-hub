use crate::paths;

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn valid_plugin_ref(v: &str) -> bool {
    !v.is_empty() && v.len() <= 200 && v.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && v.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@'))
}

pub const MAX_PROMPT_CHARS: usize = 8000;

pub fn url_for(kind: &str, value: Option<&str>) -> Result<String, String> {
    match (kind, value) {
        ("plugins", _) => Ok("claude://claude.ai/customize/plugins".into()),
        ("plugin", Some(v)) if valid_plugin_ref(v) => Ok(if v.starts_with("plugin_") {
            format!("claude://claude.ai/customize/plugins/id/{v}")
        } else {
            format!("claude://claude.ai/customize/plugins/{}", encode(v))
        }),
        ("chat", Some(p)) if !p.trim().is_empty() => {
            if p.chars().count() > MAX_PROMPT_CHARS {
                return Err(format!("요청 문장이 너무 깁니다 ({MAX_PROMPT_CHARS}자 이하)"));
            }
            Ok(format!("claude://claude.ai/new?q={}&surface=chat", encode(p)))
        }
        _ => Err("잘못된 요청입니다".into()),
    }
}

pub fn open(kind: &str, value: Option<&str>) -> Result<(), String> {
    if !paths::desktop_installed() {
        return Err("Claude 데스크톱 앱이 설치되어 있지 않습니다.".into());
    }
    let url = url_for(kind, value)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| format!("Claude 앱을 열지 못했습니다: {e}"))
}
