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

fn valid_marketplace(v: &str) -> bool {
    if v.len() > 300 {
        return false;
    }
    let safe = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.');
    if let Some(rest) = v.strip_prefix("https://") {
        let mut parts = rest.split('/');
        return parts.next().is_some_and(|h| !h.is_empty() && h.chars().all(safe))
            && rest.split('/').skip(1).all(|seg| !seg.is_empty() && seg != ".." && seg.chars().all(safe))
            && rest.split('/').count() >= 3;
    }
    let mut parts = v.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(o), Some(r), None) if !o.is_empty() && !r.is_empty() && o != ".." && r != ".." && o.chars().all(safe) && r.chars().all(safe))
}

pub const MAX_PROMPT_CHARS: usize = 8000;

pub fn url_for(kind: &str, value: Option<&str>) -> Result<String, String> {
    url_for_with(kind, value, None)
}

pub fn url_for_with(kind: &str, value: Option<&str>, plugin: Option<&str>) -> Result<String, String> {
    match (kind, value) {
        ("add-marketplace", Some(m)) if valid_marketplace(m) => {
            let mut url = format!("claude://claude.ai/customize/plugins/new?marketplace={}", encode(m));
            if let Some(p) = plugin {
                if !valid_plugin_ref(p) {
                    return Err("잘못된 플러그인 이름입니다".into());
                }
                url.push_str(&format!("&plugin={}", encode(p)));
            }
            Ok(url)
        }
        ("plugins", _) => Ok("claude://claude.ai/customize/plugins".into()),
        ("directory", _) => Ok("claude://claude.ai/directory".into()),
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

pub fn open(kind: &str, value: Option<&str>, plugin: Option<&str>) -> Result<(), String> {
    if !paths::desktop_installed() {
        return Err("Claude 데스크톱 앱이 설치되어 있지 않습니다.".into());
    }
    let url = url_for_with(kind, value, plugin)?;
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| format!("Claude 앱을 열지 못했습니다: {e}"))
}
