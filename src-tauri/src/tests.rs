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

    let a = home.join("plugins/cache/mk/a/1.0.0");
    write(a.join(".claude-plugin/plugin.json"), r#"{"name":"a","version":"1.0.0","description":"A plugin"}"#);
    write(a.join("skills/deploy/SKILL.md"), "---\nname: deploy\ndescription: 배포한다\n---\n본문");
    write(a.join("hooks/hooks.json"), r#"{"hooks":{"SessionStart":[]}}"#);
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

    let snap = scanner::scan(&[]);
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

    settings::set_enabled("a@mk", Some(false), &backups).unwrap();
    let text = fs::read_to_string(home.join("settings.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["enabledPlugins"]["a@mk"], false);
    assert_eq!(v["theme"], "dark");
    assert_eq!(v["other"], 1);
    let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
    assert_eq!(keys, ["theme", "enabledPlugins", "other"]);
    assert_eq!(fs::read_dir(&backups).unwrap().count(), 1, "수정 전 백업");

    settings::set_enabled("ghost@mk", None, &backups).unwrap();
    let snap = scanner::scan(&[]);
    assert!(!snap.diagnostics.iter().any(|d| d.id == "dangling:ghost@mk"));

    write(home.join("settings.json"), "{ broken");
    assert!(settings::set_enabled("a@mk", Some(true), &backups).is_err());
    assert_eq!(fs::read_to_string(home.join("settings.json")).unwrap(), "{ broken");
    let snap = scanner::scan(&[]);
    assert!(snap.settings_error.is_some());
    assert!(snap.diagnostics.iter().any(|d| d.id == "settings-invalid"));

    write(home.join("settings.json"), r#"{"enabledPlugins":{"a@mk":true}}"#);
    let proj = temp_dir("proj");
    let folder = crate::model::ProjectFolder { path: proj.to_string_lossy().to_string(), name: "proj".into() };
    let shared = crate::paths::project_settings(&proj, false);
    let local = crate::paths::project_settings(&proj, true);
    settings::set_enabled_in(&shared, "a@mk", Some(false), &backups).unwrap();
    settings::set_enabled_in(&local, "a@mk", Some(true), &backups).unwrap();
    settings::set_enabled_in(&shared, "nothere@mk", Some(true), &backups).unwrap();
    let snap = scanner::scan(&[folder.clone()]);
    let st = &snap.projects[0];
    assert!(st.exists);
    assert_eq!(st.shared.get("a@mk"), Some(&false));
    assert_eq!(st.local.get("a@mk"), Some(&true));
    assert!(snap.diagnostics.iter().any(|d| d.id.starts_with("project-dangling:") && d.id.ends_with("nothere@mk")), "폴더에서만 켜진 미설치 플러그인");
    settings::set_enabled_in(&local, "a@mk", None, &backups).unwrap();
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&local).unwrap()).unwrap();
    assert!(v.get("enabledPlugins").is_none());
    let other = temp_dir("proj2");
    settings::set_enabled_in(&crate::paths::project_settings(&other, true), "a@mk", None, &backups).unwrap();
    assert!(!other.join(".claude").exists());
    let gone = crate::model::ProjectFolder { path: "/nonexistent/pluginhub".into(), name: "gone".into() };
    let snap = scanner::scan(&[gone]);
    assert!(snap.diagnostics.iter().any(|d| d.id.starts_with("project-missing:")));

    unsafe { std::env::remove_var("CLAUDE_CONFIG_DIR") };
    let _ = fs::remove_dir_all(&home);
    let _ = fs::remove_dir_all(&backups);
    let _ = fs::remove_dir_all(&proj);
    let _ = fs::remove_dir_all(&other);
}

#[test]
#[ignore]
fn real_scan() {
    let s = scanner::scan(&[]);
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
fn parses_slash_command_frontmatter() {
    let fm = scanner::parse_frontmatter(
        "---\nname: deploy\ndescription: '앱을 배포한다'\nargument-hint: \"<환경> [--dry-run]\"\ndisable-model-invocation: true\nexamples:\n  - utterance: \"배포해줘\"\n    intent: \"deploy\"\n  - utterance: '왜 실패했어?'\n---\n본문",
    )
    .unwrap();
    assert_eq!(fm.name.as_deref(), Some("deploy"));
    assert_eq!(fm.description.as_deref(), Some("앱을 배포한다"));
    assert_eq!(fm.argument_hint.as_deref(), Some("<환경> [--dry-run]"));
    assert!(fm.user_invocable);
    assert!(!fm.model_invocable);
    assert_eq!(fm.examples, vec!["배포해줘", "왜 실패했어?"]);

    let fm = scanner::parse_frontmatter("---\nname: x\nuser-invocable: false\n---\n").unwrap();
    assert!(!fm.user_invocable);
    assert!(fm.model_invocable);
    assert!(scanner::parse_frontmatter("frontmatter 없음").is_none());
}

#[test]
fn tracks_new_and_updated_catalog_entries() {
    use crate::catalog::track_changes_for_test as track;
    use crate::model::{CatalogChange, CatalogEntry};
    let dir = temp_dir("seen");
    let entry = |id: &str, v: &str| CatalogEntry {
        plugin_id: id.into(),
        name: id.into(),
        description: String::new(),
        marketplace: "m".into(),
        version: Some(v.into()),
        source_url: None,
        installable: true,
        change: CatalogChange::default(),
    };
    let mut a = vec![entry("a@m", "1.0.0"), entry("b@m", "1.0.0")];
    let (n, u, first) = track(&mut a, &dir);
    assert_eq!((n, u, first), (0, 0, true));
    let mut b = vec![entry("a@m", "1.0.0"), entry("b@m", "1.1.0"), entry("c@m", "0.1.0")];
    let (n, u, first) = track(&mut b, &dir);
    assert_eq!((n, u, first), (1, 1, false));
    assert!(b[2].change.is_new);
    assert!(b[1].change.updated);
    assert!(!b[0].change.is_new && !b[0].change.updated);
    let _ = fs::remove_dir_all(&dir);
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
