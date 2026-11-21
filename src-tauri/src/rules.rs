use crate::model::{Diagnostic, Fix, Marketplace, Plugin, ProjectState};
use crate::paths::{is_semver, version_key};
use crate::scanner::SettingsInfo;
use std::collections::{BTreeMap, HashSet};

pub const MAX_RECOMMENDED_ENABLED: usize = 10;

fn diag(
    id: String,
    severity: &str,
    plugin_id: Option<&str>,
    title: String,
    detail: String,
    fix: Option<(&str, &str)>,
) -> Diagnostic {
    Diagnostic {
        id,
        severity: severity.into(),
        plugin_id: plugin_id.map(String::from),
        title,
        detail,
        fix: fix.map(|(k, l)| Fix {
            kind: k.into(),
            label: l.into(),
        }),
    }
}

pub fn evaluate(
    plugins: &[Plugin],
    settings: &SettingsInfo,
    marketplaces: &[Marketplace],
    projects: &[ProjectState],
) -> Vec<Diagnostic> {
    let mut out = Vec::new();

    let installed_ids: HashSet<&str> = plugins
        .iter()
        .filter(|p| p.surface == "cli" && p.installed)
        .map(|p| p.id.as_str())
        .collect();
    for pr in projects {
        if !pr.exists {
            out.push(diag(
                format!("project-missing:{}", pr.path),
                "warning",
                None,
                format!("등록한 폴더 '{}'를 찾을 수 없습니다", pr.name),
                format!("{}\n폴더가 옮겨졌거나 삭제되었습니다. '적용 범위' 화면에서 목록을 정리하세요.", pr.path),
                None,
            ));
            continue;
        }
        for (label, err) in [("settings.json", &pr.shared_error), ("settings.local.json", &pr.local_error)] {
            if let Some(e) = err {
                out.push(diag(
                    format!("project-invalid:{}:{label}", pr.path),
                    "error",
                    None,
                    format!("'{}' 폴더의 .claude/{label} 형식 오류", pr.name),
                    format!("이 폴더에서 Claude Code 설정이 적용되지 않을 수 있습니다. 이 앱은 파일이 고쳐질 때까지 수정하지 않습니다.\n{e}"),
                    None,
                ));
            }
        }
        for (id, on) in pr.shared.iter().chain(pr.local.iter()) {
            if *on && settings.installed_error.is_none() && !installed_ids.contains(id.as_str()) {
                out.push(diag(
                    format!("project-dangling:{}:{id}", pr.path),
                    "warning",
                    Some(id),
                    format!("'{}' 폴더에서 켜져 있지만 설치되지 않은 플러그인: {id}", pr.name),
                    "이 폴더 설정에서만 켜져 있고 이 PC에는 설치되어 있지 않습니다. 팀원이 공유 설정으로 추가했다면 설치하고, 아니면 이 폴더 설정에서 '기본값 따름'으로 바꾸세요.".into(),
                    None,
                ));
            }
        }
    }

    if let Some(e) = &settings.installed_error {
        out.push(diag(
            "installed-invalid".into(),
            "error",
            None,
            "설치 기록(installed_plugins.json)을 읽을 수 없습니다".into(),
            format!("Claude Code가 파일을 쓰는 중이면 잠시 후 자동으로 다시 검사합니다. 계속되면 파일 형식을 확인하세요. 그동안 '설치되지 않음' 검사는 건너뜁니다.\n{e}"),
            None,
        ));
    }

    if let Some(e) = &settings.error {
        out.push(diag(
            "settings-invalid".into(),
            "error",
            None,
            "settings.json을 읽을 수 없습니다".into(),
            format!("Claude Code 사용자 설정 파일 형식이 잘못되어 플러그인 설정이 적용되지 않을 수 있습니다. 이 앱은 파일이 고쳐질 때까지 설정을 수정하지 않습니다.\n{e}"),
            None,
        ));
    }

    let known: HashSet<&str> = marketplaces
        .iter()
        .map(|m| m.name.as_str())
        .chain(settings.extra_marketplaces.iter().map(|s| s.as_str()))
        .collect();

    let cli: Vec<&Plugin> = plugins.iter().filter(|p| p.surface == "cli").collect();

    for p in &cli {
        if p.enabled && !p.installed && settings.installed_error.is_none() {
            out.push(diag(
                format!("dangling:{}", p.id),
                "error",
                Some(&p.id),
                format!("{}: 켜져 있지만 설치되어 있지 않습니다", p.name),
                "settings.json의 enabledPlugins에만 남아 있는 항목입니다. 삭제 후 정리되지 않았거나 수동 편집으로 생긴 경우가 많습니다.".into(),
                Some(("remove-setting", "설정에서 항목 제거")),
            ));
        }
        if p.installed && !p.path_exists {
            out.push(diag(
                format!("missing-path:{}", p.id),
                "error",
                Some(&p.id),
                format!("{}: 설치 폴더가 없습니다", p.name),
                format!(
                    "설치 기록의 경로({})가 존재하지 않아 플러그인이 동작하지 않습니다.",
                    p.install_path.clone().unwrap_or_default()
                ),
                Some(("reinstall", "다시 설치")),
            ));
        }
        if p.path_exists && !p.manifest_ok {
            out.push(diag(
                format!("manifest:{}", p.id),
                "warning",
                Some(&p.id),
                format!("{}: plugin.json을 읽을 수 없습니다", p.name),
                ".claude-plugin/plugin.json이 없거나 형식이 잘못되었습니다. 다시 설치하면 해결되는 경우가 많습니다.".into(),
                Some(("reinstall", "다시 설치")),
            ));
        }
        if !p.marketplace.is_empty() && p.installed && !known.contains(p.marketplace.as_str()) {
            out.push(diag(
                format!("unknown-mkt:{}", p.id),
                "warning",
                Some(&p.id),
                format!("{}: 마켓플레이스 '{}'가 등록되어 있지 않습니다", p.name, p.marketplace),
                "출처 마켓플레이스가 제거된 상태라 업데이트를 받을 수 없습니다. 마켓플레이스를 다시 추가하거나 플러그인을 정리하세요.".into(),
                None,
            ));
        }
        if let (Some(cur), Some(latest)) = (&p.version, &p.latest_version) {
            if is_semver(latest) && is_semver(cur) && version_key(latest) > version_key(cur) {
                out.push(diag(
                    format!("update:{}", p.id),
                    "info",
                    Some(&p.id),
                    format!("{}: 새 버전 {} 사용 가능 (현재 {})", p.name, latest, cur),
                    "마켓플레이스에 더 새로운 버전이 있습니다.".into(),
                    Some(("update", "업데이트")),
                ));
            }
        }
        if p.enabled && !p.components.hooks.is_empty() {
            out.push(diag(
                format!("hooks:{}", p.id),
                "info",
                Some(&p.id),
                format!("{}: 자동 실행 훅이 있습니다 ({})", p.name, p.components.hooks.join(", ")),
                "이 플러그인은 세션 시작 등 특정 시점에 스크립트를 자동으로 실행합니다. 신뢰할 수 있는 출처인지 확인하세요.".into(),
                None,
            ));
        }
    }

    let enabled: Vec<&&Plugin> = cli.iter().filter(|p| p.enabled && p.installed).collect();

    let mut by_name: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for p in &enabled {
        by_name.entry(p.name.as_str()).or_default().push(p.id.as_str());
    }
    for (name, ids) in by_name.iter().filter(|(_, v)| v.len() > 1) {
        out.push(diag(
            format!("dup-name:{name}"),
            "warning",
            Some(ids[0]),
            format!("'{name}' 플러그인이 {}곳에서 동시에 켜져 있습니다", ids.len()),
            format!("{}\n같은 플러그인이 중복으로 로드되어 명령이 충돌할 수 있습니다. 하나만 켜 두세요.", ids.join(", ")),
            None,
        ));
    }

    let mut by_skill: BTreeMap<String, Vec<&str>> = BTreeMap::new();
    for p in &enabled {
        for c in p.components.skills.iter().chain(p.components.commands.iter()) {
            by_skill.entry(c.name.clone()).or_default().push(p.name.as_str());
        }
    }
    for (skill, owners) in by_skill.iter() {
        let uniq: HashSet<&&str> = owners.iter().collect();
        if uniq.len() > 1 {
            let mut names: Vec<&str> = uniq.into_iter().copied().collect();
            names.sort();
            out.push(diag(
                format!("skill-clash:{skill}"),
                "warning",
                None,
                format!("스킬 이름 '{skill}'이 여러 플러그인에 있습니다"),
                format!("{}\n이름만 말하면 Claude가 엉뚱한 플러그인의 스킬을 고를 수 있습니다. '/플러그인:{skill}'처럼 플러그인 이름을 붙여 부르거나 하나를 끄세요.", names.join(", ")),
                None,
            ));
        }
    }

    if enabled.len() > MAX_RECOMMENDED_ENABLED {
        out.push(diag(
            "too-many".into(),
            "warning",
            None,
            format!("플러그인 {}개가 켜져 있습니다 (권장 {}개 이하)", enabled.len(), MAX_RECOMMENDED_ENABLED),
            "켜진 플러그인의 스킬 설명은 매 세션 컨텍스트에 들어갑니다. 지금 쓰지 않는 플러그인은 꺼 두거나 폴더 단위로 묶어 필요할 때만 켜세요.".into(),
            None,
        ));
    }

    let desktop_names: HashSet<String> = plugins
        .iter()
        .filter(|p| p.surface == "desktop" && p.enabled)
        .map(|p| p.display_name.to_lowercase())
        .collect();
    for p in &enabled {
        if desktop_names.contains(&p.display_name.to_lowercase()) {
            out.push(diag(
                format!("both-surfaces:{}", p.id),
                "info",
                Some(&p.id),
                format!("{}: Claude 앱과 터미널 양쪽에서 켜져 있습니다", p.display_name),
                "앱(계정 동기화)과 터미널(~/.claude)에서 각각 관리됩니다. 버전이 다를 수 있으니 한쪽에서 쓰는 것을 권장합니다.".into(),
                None,
            ));
        }
    }

    let rank = |s: &str| match s {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    };
    out.sort_by_key(|d| rank(&d.severity));
    out
}
