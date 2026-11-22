use crate::model::HubState;
use crate::scanner::now_ms;
use std::fs;
use std::path::Path;

/// 앱 상태를 읽는다. 파일이 없으면 기본값. 읽기 자체가 실패하면(권한, 백신이 잠깐 잠근 경우 등) 오류를 돌려준다:
/// 기본값으로 대신하면 다음 저장 때 등록한 폴더·그룹·동의 기록이 지워지기 때문이다.
pub fn load(dir: &Path) -> Result<HubState, String> {
    let file = dir.join("hub-state.json");
    let text = match fs::read_to_string(&file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(HubState::default()),
        Err(e) => return Err(format!("앱 설정 파일(hub-state.json)을 읽지 못했습니다. 잠시 후 다시 시도하세요: {e}")),
    };
    match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(s) => Ok(s),
        Err(e) => {
            // 형식이 깨진 파일은 백업이 확실히 된 경우에만 초기화한다.
            let backup = dir.join(format!("hub-state.broken-{}.json", now_ms()));
            fs::rename(&file, &backup).map_err(|re| format!("앱 설정 파일 형식 오류({e}), 백업도 실패해 수정하지 않습니다: {re}"))?;
            eprintln!("[store] hub-state.json 형식 오류, {} 로 백업 후 초기화: {e}", backup.display());
            Ok(HubState::default())
        }
    }
}

pub fn save(dir: &Path, state: &HubState) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&dir.join("hub-state.json"), &text)
}
