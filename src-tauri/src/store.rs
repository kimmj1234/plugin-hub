//! 앱 자체 상태(폴더 그룹) 저장. Claude 설정과 분리해 앱 데이터 폴더에 둔다.

use crate::model::HubState;
use std::fs;
use std::path::Path;

pub fn load(dir: &Path) -> HubState {
    fs::read_to_string(dir.join("hub-state.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, state: &HubState) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("hub-state.json.tmp");
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("hub-state.json")).map_err(|e| e.to_string())
}
