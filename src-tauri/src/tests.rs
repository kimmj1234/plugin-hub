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

    // 방금 쓴 settings.json: 공식 CLI가 설치 기록을 쓰기 전 상태와 같다 → 오류가 아니라 "설치 마무리 중"
    let fresh = scanner::scan(&[]);
    let fresh_ids: Vec<&str> = fresh.diagnostics.iter().map(|d| d.id.as_str()).collect();
    assert!(fresh_ids.contains(&"installing:ghost@mk"), "설치 직후에는 오류 대신 진행 중 안내");
    assert!(!fresh_ids.contains(&"dangling:ghost@mk"), "설치 직후 빨간 오류가 뜨면 안 됨");
    assert_eq!(fresh.diagnostics.iter().find(|d| d.id == "installing:ghost@mk").unwrap().severity, "info");

    // 시간이 지나도 설치 기록이 없으면 진짜 오류다
    let old = std::time::SystemTime::now() - std::time::Duration::from_secs(scanner::INSTALL_GRACE_SECS + 5);
    fs::File::options().write(true).open(home.join("settings.json")).unwrap().set_modified(old).unwrap();

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
    assert!(snap.diagnostics.iter().any(|d| d.id == "installing:nothere@mk"), "폴더 설정도 방금 바뀌었으면 설치 진행 중으로 본다");
    for f in [&shared, &local] {
        fs::File::options().write(true).open(f).unwrap().set_modified(old).unwrap();
    }
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
            "[{}] {} ({}) enabled={} skills={} hooks={:?} app_ref={:?}",
            p.surface, p.id, p.display_name, p.enabled, p.components.skills.len(), p.components.hooks, p.app_ref
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
        for e in c.entries.iter().filter(|e| ["unity", "superpowers", "frontend-design", "feature-dev"].contains(&e.name.as_str())) {
            println!("  {} -> app name {:?}", e.name, e.app_name);
        }
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
        app_name: None,
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
    assert_eq!(url_for("directory", None).unwrap(), "claude://claude.ai/directory");
    use crate::claude_app::repo_of_for_test as repo_of;
    assert_eq!(repo_of("https://github.com/obra/superpowers").as_deref(), Some("obra/superpowers"));
    assert_eq!(repo_of("https://github.com/o/r.git/").as_deref(), Some("o/r"));
    assert_eq!(repo_of("https://gitlab.com/o/r"), None);
    use crate::claude_app::url_for_with;
    assert_eq!(
        url_for_with("add-marketplace", Some("jocoding-ax-partners/axhub"), Some("axhub")).unwrap(),
        "claude://claude.ai/customize/plugins/new?marketplace=jocoding-ax-partners%2Faxhub&plugin=axhub"
    );
    assert!(url_for_with("add-marketplace", Some("https://github.com/o/r.git"), None).is_ok());
    assert!(url_for_with("add-marketplace", Some("../etc"), None).is_err());
    assert!(url_for_with("add-marketplace", Some("o/r/x"), None).is_err());
    assert!(url_for_with("add-marketplace", Some("o/r&x=1"), None).is_err());
    assert!(url_for_with("add-marketplace", Some("o/r"), Some("a/b")).is_err());
    assert!(url_for_with("add-marketplace", Some("http://evil/x/y"), None).is_err());
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

#[cfg(target_os = "macos")]
#[test]
#[ignore]
fn auto_install_real() {
    let name = std::env::var("PLUGIN_NAME").expect("PLUGIN_NAME");
    let url = std::env::var("PLUGIN_URL").ok();
    let r = crate::claude_app::auto_install(&name, url.as_deref());
    println!("auto_install({name}) = {r:?}");
    assert!(r.is_ok());
}

#[test]
fn usage_counts_skills_commands_agents_mcp() {
    use crate::usage;
    let names: Vec<String> = ["axhub", "commit-commands", "my_tool"].iter().map(|s| s.to_string()).collect();
    let line = r#"{"type":"assistant","timestamp":"2026-11-20T10:00:00.000Z","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"axhub:deploy"}}]}}"#;
    assert_eq!(usage::plugins_in_line(line, &names), vec!["axhub"]);
    let cmd = r#"{"type":"user","message":{"content":"<command-name>/commit-commands:commit</command-name>"}}"#;
    assert_eq!(usage::plugins_in_line(cmd, &names), vec!["commit-commands"]);
    let mcp = r#"{"content":[{"type":"tool_use","name":"mcp__plugin_my_tool_server__run"}]}"#;
    assert_eq!(usage::plugins_in_line(mcp, &names), vec!["my_tool"]);
    // 접두사 없는 스킬, 모르는 플러그인은 세지 않는다
    let other = r#"{"name":"Skill","input":{"skill":"dataviz"}} {"subagent_type":"general-purpose"} {"subagent_type":"unknown:agent"}"#;
    assert!(usage::plugins_in_line(other, &names).is_empty());

    assert_eq!(usage::iso_utc(0), "1970-01-01T00:00:00");
    assert_eq!(usage::iso_utc(1_795_219_200), "2026-11-21T00:00:00");

    let root = temp_dir("usage");
    write(
        root.join("proj/a.jsonl"),
        &[
            line,
            line,
            cmd,
            r#"{"timestamp":"2020-01-01T00:00:00.000Z","name":"Skill","input":{"skill":"commit-commands:commit"}}"#,
        ]
        .join("\n"),
    );
    let now = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_795_219_200);
    // 파일 수정 시각은 지금이라 30일 범위 안. 2020년 줄은 timestamp로 제외된다.
    let r = usage::scan_in(&root, &names, 30, std::time::SystemTime::now().max(now));
    let ax = r.plugins.iter().find(|u| u.plugin == "axhub").unwrap();
    assert_eq!(ax.count, 2);
    assert_eq!(ax.last_used.as_deref(), Some("2026-11-20T10:00:00.000Z"));
    assert_eq!(r.plugins.iter().find(|u| u.plugin == "commit-commands").unwrap().count, 1);
    assert_eq!(r.sessions, 1);
}

#[test]
#[ignore]
fn usage_real_readonly() {
    let names: Vec<String> = ["axhub", "frontend-design", "feature-dev", "commit-commands", "anthropic-skills"].iter().map(|s| s.to_string()).collect();
    let t = std::time::Instant::now();
    let r = crate::usage::scan(&names, 30);
    println!("{:?} in {:?}", r, t.elapsed());
}

/// 실제 계정으로 한국어 가이드를 만들어 앱 데이터 폴더에 저장한다 (PLUGIN_ID 필요, ~/.claude는 읽기만).
#[test]
#[ignore]
fn guide_real_generate() {
    let id = std::env::var("PLUGIN_ID").expect("PLUGIN_ID");
    let s = scanner::scan(&[]);
    let p = s.plugins.iter().find(|p| p.id == id && p.surface == "cli").expect("설치된 플러그인");
    let dir = dirs::data_dir().unwrap().join("dev.kimmj1234.pluginhub");
    let t = std::time::Instant::now();
    let g = crate::guide::generate(&dir, &p.id, p.version.as_deref(), &crate::guide::context_from_plugin(p)).unwrap();
    println!("{:?}\n{:#?}", t.elapsed(), g);
}

/// 실제 공식 CLI로 격리된 폴더에 설치하면서 50ms마다 검사해, 설치 도중 빨간 오류(dangling)가 한 번도 나오지 않는지 확인한다.
/// CLI_BIN(claude 실행 파일)과 PLUGIN_ID가 필요하다. 실제 ~/.claude는 건드리지 않는다.
#[test]
#[ignore]
fn install_race_real() {
    let bin = std::env::var("CLI_BIN").expect("CLI_BIN");
    let id = std::env::var("PLUGIN_ID").expect("PLUGIN_ID");
    let home = temp_dir("race");
    unsafe { std::env::set_var("CLAUDE_CONFIG_DIR", &home) };
    let mut child = std::process::Command::new(&bin)
        .args(["plugin", "install", &id, "-s", "user", "--json"])
        .env("CLAUDE_CONFIG_DIR", &home)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let (mut scans, mut installing_seen, mut dangling_seen) = (0, 0, 0);
    loop {
        let done = child.try_wait().unwrap().is_some();
        let s = scanner::scan(&[]);
        scans += 1;
        if s.diagnostics.iter().any(|d| d.id.starts_with("dangling:")) {
            dangling_seen += 1;
        }
        if s.diagnostics.iter().any(|d| d.id.starts_with("installing:")) {
            installing_seen += 1;
        }
        if done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let s = scanner::scan(&[]);
    let installed = s.plugins.iter().any(|p| p.id == id && p.installed && p.enabled);
    println!("scans={scans} installing_seen={installing_seen} dangling_seen={dangling_seen} installed={installed}");
    let _ = fs::remove_dir_all(&home);
    assert!(installed, "설치 완료");
    assert_eq!(dangling_seen, 0, "설치 도중 빨간 오류가 나오면 안 됨");
}

#[test]
fn security_defenses() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let d = temp_dir("sec");

    // 1) 외부 플러그인 파일: 링크·장치·거대 파일 거부
    let secret = d.join("secret.txt");
    write(secret.clone(), "PRIVATE KEY");
    let plugin = d.join("plugin");
    fs::create_dir_all(plugin.join(".claude-plugin")).unwrap();
    symlink(&secret, plugin.join("README.md")).unwrap();
    assert!(scanner::read_limited(&plugin.join("README.md"), scanner::MAX_README_BYTES, false).is_err(), "README 링크로 다른 파일을 읽으면 안 됨");
    symlink("/dev/zero", plugin.join(".claude-plugin/plugin.json")).unwrap();
    assert!(scanner::read_plugin_json(&plugin.join(".claude-plugin/plugin.json")).is_err(), "/dev/zero 링크 거부");
    assert!(scanner::read_limited(std::path::Path::new("/dev/zero"), 1024, true).is_err(), "장치 파일 거부");
    let big = d.join("big.json");
    fs::write(&big, vec![b' '; (scanner::MAX_PLUGIN_JSON_BYTES + 10) as usize]).unwrap();
    assert!(scanner::read_plugin_json(&big).is_err(), "1MB 넘는 플러그인 JSON 거부");
    // 사용자 설정 파일은 dotfiles 링크를 허용
    let real_settings = d.join("dotfiles-settings.json");
    write(real_settings.clone(), r#"{"a":1}"#);
    symlink(&real_settings, d.join("settings-link.json")).unwrap();
    assert_eq!(scanner::read_json(&d.join("settings-link.json")).unwrap()["a"], 1);

    // 2) 설정 저장 시 원래 권한 유지 (0600 → 0600)
    let s = d.join("settings.json");
    write(s.clone(), "{}");
    fs::set_permissions(&s, fs::Permissions::from_mode(0o600)).unwrap();
    settings::write_atomic(&s, r#"{"x":1}"#).unwrap();
    assert_eq!(fs::metadata(&s).unwrap().permissions().mode() & 0o777, 0o600, "권한이 넓어지면 안 됨");
    assert_eq!(fs::read_to_string(&s).unwrap(), r#"{"x":1}"#);

    // 3) 프로젝트의 .claude가 밖을 가리키는 링크면 쓰기 거부
    let proj = d.join("cloned-repo");
    fs::create_dir_all(&proj).unwrap();
    let outside = d.join("victim");
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, proj.join(".claude")).unwrap();
    assert!(settings::project_settings_checked(&proj, true).is_err(), ".claude 링크 탈출 거부");
    let proj2 = d.join("repo2");
    fs::create_dir_all(proj2.join(".claude")).unwrap();
    symlink(&s, proj2.join(".claude/settings.local.json")).unwrap();
    assert!(settings::project_settings_checked(&proj2, true).is_err(), "설정 파일 링크 탈출 거부");
    let proj3 = d.join("repo3");
    fs::create_dir_all(&proj3).unwrap();
    assert!(settings::project_settings_checked(&proj3, false).is_ok(), "정상 폴더는 허용");

    // 4) 작업 폴더로 등록하면 안 되는 위치
    assert!(crate::paths::forbidden_project(std::path::Path::new("/System/Library")).is_some());
    assert!(crate::paths::forbidden_project(std::path::Path::new("/etc")).is_some());
    let home = fs::canonicalize(crate::paths::home()).unwrap();
    assert!(crate::paths::forbidden_project(&home).is_some());
    assert!(crate::paths::forbidden_project(&home.join("Library/Application Support")).is_some());
    assert!(crate::paths::forbidden_project(&home.join(".ssh")).is_some());
    assert!(crate::paths::forbidden_project(&home.join("Project/my-app")).is_none(), "일반 프로젝트는 허용");
    assert!(crate::paths::forbidden_project(std::path::Path::new("/Volumes/Ext/code/app")).is_none(), "외장 디스크 프로젝트 허용");

    // 5) 가이드 프롬프트 길이 제한
    assert_eq!(crate::guide::truncate(&"가".repeat(50_000), crate::guide::CONTEXT_LIMIT).len() <= crate::guide::CONTEXT_LIMIT, true);
    let _ = fs::remove_dir_all(&d);
}

#[cfg(target_os = "macos")]
#[test]
fn ax_choice_is_strict() {
    use crate::mac_ax::{choose_button, choose_link};
    let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    // 저장소가 맞는 결과를 고른다
    assert_eq!(choose_link(&[v(&["Superpowers", "evil/superpowers"]), v(&["Superpowers", "obra/superpowers"])], Some("obra/superpowers")), Ok(Some(1)));
    // 저장소가 다르게 표시된 결과만 있으면 고르지 않는다
    assert_eq!(choose_link(&[v(&["Superpowers", "evil/superpowers"])], Some("obra/superpowers")), Ok(None));
    // 저장소 표시가 없는 결과는 하나뿐일 때만
    assert_eq!(choose_link(&[v(&["skill-creator"])], Some("anthropics/skills")), Ok(Some(0)));
    assert!(choose_link(&[v(&["x"]), v(&["x"])], None).is_err(), "같은 이름 여러 개면 멈춤");
    // 버튼: 이름 근처 하나 / 근처 없으면 전체 하나뿐일 때만 / 그 외 멈춤
    assert_eq!(choose_button(1, 3), Ok(Some(true)));
    assert_eq!(choose_button(0, 1), Ok(Some(false)));
    assert_eq!(choose_button(0, 0), Ok(None));
    assert!(choose_button(0, 2).is_err());
    assert!(choose_button(2, 2).is_err());
}

#[test]
fn guide_json_extraction_never_panics() {
    use crate::guide::extract_json;
    // claude-security 스캔 F1: 괄호 순서가 뒤집힌 모델 출력으로 패닉(=앱 종료)하던 문제
    for evil in ["} guide unavailable {", "}{", "}", "{", "", "}}} {{{", "가}나{다", "{\"a\":1} 끝 }"] {
        let _ = extract_json(evil);
    }
    assert!(extract_json("} x {").is_none());
    let v = extract_json("설명: {\"summary\":\"요약\"} 끝").unwrap();
    assert_eq!(v.get("summary").and_then(|v| v.as_str()), Some("요약"));
}

#[test]
fn manifest_custom_component_paths() {
    let root = temp_dir("manifest");
    let outside = temp_dir("manifest-outside");
    write(outside.join("SKILL.md"), "---\nname: stolen\ndescription: 밖\n---\n");
    // humanizer·video-shotcraft처럼 루트에 SKILL.md가 있고 "skills": "./" 또는 ["./"]
    write(root.join("SKILL.md"), "---\nname: humanizer\ndescription: 글을 사람처럼\n---\n");
    write(root.join("extra/skills/a/SKILL.md"), "---\nname: a-skill\ndescription: A\n---\n");
    write(root.join("cmds/run.md"), "---\ndescription: 실행\n---\n");
    let rel_out = format!("../{}", outside.file_name().unwrap().to_string_lossy());
    let manifest = serde_json::json!({
        "name": "humanizer",
        "skills": ["./", "./extra/skills", rel_out, "/etc"],
        "commands": "./cmds"
    });
    let c = scanner::components(&root, &manifest);
    let names: Vec<&str> = c.skills.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"humanizer"), "루트 SKILL.md");
    assert!(names.contains(&"a-skill"), "추가 스킬 폴더");
    assert!(!names.contains(&"stolen"), "플러그인 밖 경로는 무시");
    assert_eq!(c.commands.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["run"]);
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&outside);
}
