//! 대화 기록에서 플러그인을 실제로 얼마나 썼는지 센다.
//! 기록 파일은 읽기만 하고, 대화 내용은 저장하거나 밖으로 보내지 않는다.
//! 세는 것: 스킬 호출(Skill 도구), 슬래시 명령 입력, 플러그인 에이전트 호출, 플러그인 MCP 도구 호출.

use crate::paths;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginUsage {
    pub plugin: String,
    pub count: u32,
    pub last_used: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub days: u32,
    pub sessions: u32,
    pub plugins: Vec<PluginUsage>,
}

const MARKERS: [&str; 4] = [
    "\"name\":\"Skill\",\"input\":{\"skill\":\"",
    "\"content\":\"<command-name>/",
    "\"subagent_type\":\"",
    "\"name\":\"mcp__plugin_",
];

/// 한 줄에서 쓰인 플러그인 이름들을 찾는다. `names`는 설치된 플러그인 이름.
pub fn plugins_in_line<'a>(line: &str, names: &'a [String]) -> Vec<&'a str> {
    let mut out: Vec<&str> = Vec::new();
    for (i, m) in MARKERS.iter().enumerate() {
        let mut rest = line;
        while let Some(pos) = rest.find(m) {
            rest = &rest[pos + m.len()..];
            let token: &str = rest.split(['"', '<', ' ', '\\']).next().unwrap_or("");
            let hit = if i == 3 {
                // mcp__plugin_<플러그인>_<서버>__<도구>
                names.iter().find(|n| token.starts_with(&format!("{n}_")))
            } else {
                token.split_once(':').and_then(|(p, _)| names.iter().find(|n| n.as_str() == p))
            };
            if let Some(n) = hit
                && !out.contains(&n.as_str()) {
                    out.push(n.as_str());
                }
        }
    }
    out
}

fn timestamp(line: &str) -> Option<&str> {
    let key = "\"timestamp\":\"";
    let i = line.find(key)? + key.len();
    let s = &line[i..];
    s.find('"').map(|e| &s[..e])
}

/// 유닉스 초 → ISO 날짜시각 문자열(UTC, 초 단위). 기록의 timestamp와 문자열로 비교한다.
pub fn iso_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant의 civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn jsonl_files(dir: &Path, since: SystemTime, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 4 {
        return;
    }
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(meta) = e.metadata() else { continue };
        if meta.is_dir() {
            jsonl_files(&p, since, out, depth + 1);
        } else if p.extension().is_some_and(|x| x == "jsonl") && meta.modified().map(|m| m >= since).unwrap_or(false) {
            out.push(p);
        }
    }
}

pub fn scan_in(root: &Path, names: &[String], days: u32, now: SystemTime) -> UsageReport {
    let since = now - Duration::from_secs(days as u64 * 86_400);
    let cutoff = iso_utc(since.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));
    let mut files = Vec::new();
    jsonl_files(root, since, &mut files, 0);
    let mut map: HashMap<&str, PluginUsage> = HashMap::new();
    for f in &files {
        let Ok(file) = fs::File::open(f) else { continue };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if !MARKERS.iter().any(|m| line.contains(m)) {
                continue;
            }
            let ts = timestamp(&line);
            if ts.is_some_and(|t| t < cutoff.as_str()) {
                continue;
            }
            for n in plugins_in_line(&line, names) {
                let u = map.entry(n).or_insert_with(|| PluginUsage { plugin: n.to_string(), ..Default::default() });
                u.count += 1;
                if let Some(t) = ts
                    && u.last_used.as_deref().is_none_or(|l| t > l) {
                        u.last_used = Some(t.to_string());
                    }
            }
        }
    }
    let mut plugins: Vec<PluginUsage> = map.into_values().collect();
    plugins.sort_by(|a, b| b.count.cmp(&a.count).then(a.plugin.cmp(&b.plugin)));
    UsageReport { days, sessions: files.len() as u32, plugins }
}

pub fn scan(names: &[String], days: u32) -> UsageReport {
    scan_in(&paths::transcripts_dir(), names, days, SystemTime::now())
}
