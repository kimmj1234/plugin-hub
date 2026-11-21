use crate::model::HubState;
use crate::scanner::now_ms;
use std::fs;
use std::path::Path;

pub fn load(dir: &Path) -> HubState {
    let file = dir.join("hub-state.json");
    let Ok(text) = fs::read_to_string(&file) else {
        return HubState::default();
    };
    match serde_json::from_str(&text) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[store] hub-state.json 형식 오류, 백업 후 초기화: {e}");
            let _ = fs::rename(&file, dir.join(format!("hub-state.broken-{}.json", now_ms())));
            HubState::default()
        }
    }
}

pub fn save(dir: &Path, state: &HubState) -> Result<(), String> {
    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    crate::settings::write_atomic(&dir.join("hub-state.json"), &text)
}
