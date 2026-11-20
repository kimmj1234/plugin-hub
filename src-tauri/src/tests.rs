//! 실제 ~/.claude 를 건드리지 않도록 CLAUDE_CONFIG_DIR을 임시 폴더로 바꿔 검증한다.
//! 환경 변수는 프로세스 전역이라 하나의 테스트 안에서 순서대로 실행한다.

use crate::{scanner, settings};
use std::fs;
use std::path::PathBuf;

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pluginhub-test-{name}-{}", scanner::now_ms()));
    fs::create_dir_all(&d).unwrap();
    d
}

fn write(p: PathBuf, s: &str) {
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}

#[test]
fn scan_rules_and_toggle_on_fake_home() {
    let home = temp_dir("home");
    let backups = temp_dir("backups");
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", &home) };

    // 플러그인 a: 정상 설치 + 켜짐, 스킬 'deploy' + 훅
    let a = home.join("plugins/cache/mk/a/1.0.0");
    write(a.join(".claude-plugin/plugin.json"), r#"{"name":"a","version":"1.0.0","description":"A plugin"}"#);
    write(a.join("skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: 배포한다\n---\n본문");
    write(a.join("hooks/hooks.json"), r#"{"hooks":{"SessionStart":[]}}"#);
    // 플러그인 b: 정상 설치 + 켜짐, 같은 스킬 이름 'deploy' → 충돌 경고
    let b = home.join("plugins/cache/mk/b/1.0.0");
    write(b.join(".claude-plugin/plugin.json"), r#"{"name":"b","version":"1.0.0"}"#);
    write(b.join("skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: >\n  여러 줄\n  설명\n---\n");

    write(
        home.join("plugins/installed_plugins.json"),
        &format!(
            r#"{{"version":2,"plugins":{{
              "a@mk":[{{"scope":"user","installPath":"{}","version":"1.0.0"}}],
              "b@mk":[{{"scope":"user","installPath":"{}","version":"1.0.0"}}],
              "gone@mk":[{{"scope":"user","installPath":"/nonexistent/path","version":"0.1.0"}}]
            }}}}"#,
            a.display(),
            b.display()
        ),
    );
    write(
        home.join("plugins/known_marketplaces.json"),
        &format!(r#"{{"mk":{{"source":{{"source":"github","repo":"o/mk"}},"installLocation":"{}"}}}}"#, home.join("plugins/marketplaces/mk").display()),
    );
    write(
        home.join("plugins/marketplaces/mk/.claude-plugin/marketplace.json"),
        r#"{"name":"mk","plugins":[{"name":"a","version":"1.2.0"},{"name":"b","version":"1.0.0"}]}"#,
    );
    write(
        home.join("settings.json"),
        r#"{"theme":"dark","enabledPlugins":{"a@mk":true,"b@mk":true,"ghost@mk":true},"other":1}"#,
    );

    let snap = scanner::scan();
    let ids: Vec<&str> = snap.diagnostics.iter().map(|d| d.id.as_str()).collect();
    println!("{ids:#?}");

    let a_p = snap.plugins.iter().find(|p| p.id == "a@mk").unwrap();
    assert_eq!(a_p.components.skills[0].description, "배포한다");
    assert_eq!(a_p.latest_version.as_deref(), Some("1.2.0"));
    let b_p = snap.plugins.iter().find(|p| p.id == "b@mk").unwrap();
    assert_eq!(b_p.components.skills[0].description, "여러 줄 설명");

    assert!(ids.contains(&"dangling:ghost@mk"), "켜져 있지만 미설치");
    assert!(ids.contains(&"missing-path:gone@mk"), "설치 폴더 없음");
    assert!(ids.contains(&"update:a@mk"), "업데이트 가능");
    assert!(ids.contains(&"hooks:a@mk"), "훅 안내");
    assert!(ids.contains(&"skill-clash:deploy"), "스킬 충돌");
    assert!(!ids.contains(&"update:b@mk"), "같은 버전은 업데이트 아님");
    assert_eq!(snap.diagnostics[0].severity, "error", "오류가 먼저 정렬");

    // 끄기: 다른 설정 키와 순서가 보존되어야 한다
    settings::set_enabled("a@mk", Some(false), &backups).unwrap();
    let text = fs::read_to_string(home.join("settings.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["enabledPlugins"]["a@mk"], false);
    assert_eq!(v["theme"], "dark");
    assert_eq!(v["other"], 1);
    let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["theme", "enabledPlugins", "other"]);
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1, "수정 전 백업");

    // 설정 찌꺼기 제거 후에는 dangling 진단이 사라진다
    settings::set_enabled("ghost@mk", None, &backups).unwrap();
    let snap = scanner::scan();
    assert!(!snap.diagnostics.iter().any(|d| d.id == "dangling:ghost@mk"));

    // 형식이 깨진 settings.json은 수정하지 않는다
    write(home.join("settings.json"), "{ broken");
    assert!(settings::set_enabled("a@mk", Some(true), &backups).is_err());
    assert_eq!(fs::read_to_string(home.join("settings.json")).unwrap(), "{ broken");
    let snap = scanner::scan();
    assert!(snap.settings_error.is_some());
    assert!(snap.diagnostics.iter().any(|d| d.id == "settings-invalid"));

    unsafe { std::env::remove_var("CLAUDE_CONFIG_DIR") };
    let _ = fs::remove_dir_all(&home);
    let _ = fs::remove_dir_all(&backups);
}

/// 실제 환경 읽기 전용 점검: `cargo test real_scan -- --ignored --nocapture`
#[test]
#[ignore]
fn real_scan() {
    let s = scanner::scan();
    println!("env: {:#?}", s.env);
    for p in &s.plugins {
        println!(
            "[{}] {} enabled={} skills={} hooks={:?}",
            p.surface, p.id, p.enabled, p.components.skills.len(), p.components.hooks
        );
    }
    for d in &s.diagnostics {
        println!("{} {} — {}", d.severity, d.id, d.title);
    }
}

#[test]
fn rejects_unsafe_ids() {
    use crate::cli::validate_id;
    assert!(validate_id("axhub@axhub").is_ok());
    assert!(validate_id("--help").is_err());
    assert!(validate_id("a b").is_err());
    assert!(validate_id("a;rm").is_err());
    assert!(validate_id("").is_err());
}
