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
              "gone@mk":[{{"scope":"user","installPath":"/nonexistent/path","version":"0.1.0"}}],
              "fd@anthropic-plugin-directory":[{{"scope":"user","installPath":"{}","version":"1.1.1-73c8cf3ea7e2"}}]
            }}}}"#,
            a.display(),
            b.display(),
            b.display()
        ),
    );
    write(
        home.join("plugins/plugin-directory-cache-v2.json"),
        r#"{"schemaVersion":2,"listings":[{"name":"fd","release":{"version":"1.1.1"}}]}"#,
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
    assert!(!ids.iter().any(|i| i.starts_with("unknown-mkt:fd@")), "내장 공식 디렉터리는 등록된 것으로 취급");
    assert!(!ids.contains(&"update:fd@anthropic-plugin-directory"), "1.1.1-해시는 1.1.1과 같은 버전");
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

    write(home.join("plugins/installed_plugins.json"), "{ broken");
    let snap = scanner::scan(&[]);
    assert!(snap.diagnostics.iter().any(|d| d.id == "installed-invalid"));
    assert!(!snap.diagnostics.iter().any(|d| d.id.starts_with("dangling:")));

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
    let data = temp_dir("real-catalog");
    if let Ok(c) = crate::catalog::load(&data) {
        let with_id = c.entries.iter().filter(|e| e.directory_id.is_some()).count();
        let app = c.entries.iter().filter(|e| e.surfaces.iter().any(|s| s == "cowork" || s == "claude_ai")).count();
        println!("catalog {} entries, directory id {with_id}, app usable {app}", c.entries.len());
    }
    let _ = fs::remove_dir_all(&data);
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
        directory_id: None,
        surfaces: Vec::new(),
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

#[test]
#[ignore]
fn e2e_real_cli_isolated() {
    use crate::{catalog, cli};
    use std::time::Duration;
    let t = Duration::from_secs(180);
    let home = temp_dir("e2e-home");
    let data = temp_dir("e2e-data");
    let proj = temp_dir("e2e-proj");
    let mkt = temp_dir("e2e-mkt");
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", &home) };

    write(mkt.join(".claude-plugin/marketplace.json"), r#"{"name":"e2e-mkt","owner":{"name":"t"},"plugins":[{"name":"hello","source":"./plugins/hello","description":"hello plugin","version":"1.0.0"}]}"#);
    let pl = mkt.join("plugins/hello");
    write(pl.join(".claude-plugin/plugin.json"), r#"{"name":"hello","version":"1.0.0","description":"hello plugin"}"#);
    write(pl.join("commands/greet.md"), "---\ndescription: 인사한다\nargument-hint: <이름>\n---\n$ARGUMENTS 에게 인사");

    let ok = |r: Result<crate::model::CliResult, String>, what: &str| {
        let r = r.unwrap_or_else(|e| panic!("{what}: {e}"));
        assert!(r.ok, "{what} 실패: {} {}", r.stdout, r.stderr);
    };
    ok(cli::run(&["plugin", "marketplace", "add", mkt.to_str().unwrap()], t), "marketplace add");
    ok(cli::run(&["plugin", "install", "hello@e2e-mkt", "-s", "user", "--json"], t), "install user");

    let folder = crate::model::ProjectFolder { path: proj.to_string_lossy().into(), name: "proj".into() };
    let snap = scanner::scan(std::slice::from_ref(&folder));
    let p = snap.plugins.iter().find(|p| p.id == "hello@e2e-mkt").expect("설치 후 스캔에 보여야 함");
    assert!(p.enabled && p.installed && p.path_exists && p.manifest_ok);
    assert_eq!(p.components.commands.len(), 1);
    assert_eq!(p.components.commands[0].argument_hint.as_deref(), Some("<이름>"));

    settings::set_enabled("hello@e2e-mkt", Some(false), &data.join("b")).unwrap();
    let snap = scanner::scan(std::slice::from_ref(&folder));
    assert!(!snap.plugins.iter().find(|p| p.id == "hello@e2e-mkt").unwrap().enabled);
    let listed = cli::run(&["plugin", "list", "--json"], t).unwrap();
    assert!(listed.stdout.contains("hello@e2e-mkt"));

    settings::set_enabled_in(&crate::paths::project_settings(&proj, true), "hello@e2e-mkt", Some(true), &data.join("b")).unwrap();
    let snap = scanner::scan(std::slice::from_ref(&folder));
    assert_eq!(snap.projects[0].local.get("hello@e2e-mkt"), Some(&true));

    let cat = catalog::load(&data).expect("카탈로그");
    assert!(cat.entries.iter().any(|e| e.plugin_id == "hello@e2e-mkt"), "카탈로그 출처 {}", cat.origin);

    ok(cli::run(&["plugin", "uninstall", "hello@e2e-mkt", "-s", "user", "--json"], t), "uninstall user");
    ok(cli::run_in(&proj, &["plugin", "install", "hello@e2e-mkt", "-s", "local", "--json"], t), "install local");
    let snap = scanner::scan(std::slice::from_ref(&folder));
    let p = snap.plugins.iter().find(|p| p.id == "hello@e2e-mkt").expect("폴더 설치 후 보여야 함");
    assert_eq!(p.scope.as_deref(), Some("local"));
    assert_eq!(p.project_path.as_deref().map(|s| std::fs::canonicalize(s).unwrap()), Some(std::fs::canonicalize(&proj).unwrap()));
    ok(cli::run_in(&proj, &["plugin", "uninstall", "hello@e2e-mkt", "-s", "local", "--json"], t), "uninstall local");
    let snap = scanner::scan(std::slice::from_ref(&folder));
    assert!(snap.plugins.iter().all(|p| p.id != "hello@e2e-mkt" || !p.installed));

    unsafe { std::env::remove_var("CLAUDE_CONFIG_DIR") };
    for d in [&home, &data, &proj, &mkt] {
        let _ = fs::remove_dir_all(d);
    }
}

#[test]
fn settings_writes_are_safe() {
    let dir = temp_dir("writes");
    let backups = dir.join("b");
    let file = dir.join("settings.json");
    write(file.clone(), r#"{"model":"x"}"#);
    let handles: Vec<_> = (0..16)
        .map(|i| {
            let f = file.clone();
            let b = backups.clone();
            std::thread::spawn(move || settings::set_enabled_in(&f, &format!("p{i}@m"), Some(true), &b).unwrap())
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(v["enabledPlugins"].as_object().unwrap().len(), 16);
    assert_eq!(v["model"], "x");
    assert!(fs::read_dir(&dir).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));

    #[cfg(unix)]
    {
        let real = dir.join("real.json");
        write(real.clone(), "{}");
        let link = dir.join("link.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        settings::set_enabled_in(&link, "a@m", Some(false), &backups).unwrap();
        assert!(link.is_symlink());
        assert!(fs::read_to_string(&real).unwrap().contains("a@m"));
    }
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn builds_claude_app_links_safely() {
    use crate::claude_app::url_for;
    assert_eq!(url_for("plugin", Some("plugin_016Wk")).unwrap(), "claude://claude.ai/customize/plugins/id/plugin_016Wk");
    assert_eq!(url_for("plugin", Some("design@knowledge-work-plugins")).unwrap(), "claude://claude.ai/customize/plugins/design%40knowledge-work-plugins");
    assert!(url_for("plugin", Some("../x")).is_err());
    assert!(url_for("plugin", Some("a/b")).is_err());
    assert_eq!(url_for("chat", Some("표 만들어 줘 & 정리")).unwrap(), "claude://claude.ai/new?q=%ED%91%9C%20%EB%A7%8C%EB%93%A4%EC%96%B4%20%EC%A4%98%20%26%20%EC%A0%95%EB%A6%AC&surface=chat");
    assert!(url_for("chat", Some("  ")).is_err());
    assert!(url_for("chat", Some(&"가".repeat(8001))).is_err());
    assert!(url_for("other", None).is_err());
}

#[test]
fn version_compare_only_for_semver() {
    use crate::paths::is_semver;
    assert!(is_semver("1.2.3") && is_semver("v2.0") && is_semver("1.0.0-beta.1"));
    assert!(!is_semver("unknown") && !is_semver("a1b2c3d") && !is_semver(""));
}

#[cfg(unix)]
#[test]
fn cli_timeout_kills_child_tree() {
    let started = std::time::Instant::now();
    let r = crate::cli::run_raw_for_test(
        std::path::Path::new("/bin/sh"),
        &["-c", "sleep 30 & sleep 30"],
        std::time::Duration::from_millis(500),
    )
    .unwrap();
    assert!(!r.ok);
    assert!(r.stderr.contains("시간 초과"));
    assert!(started.elapsed() < std::time::Duration::from_secs(8));
}
