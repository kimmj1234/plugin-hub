use core_foundation::array::CFArray;
use core_foundation::base::{CFRelease, CFRetain, CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{CGEvent, CGEventFlags};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use std::ffi::c_void;
use std::process::Command;
use std::time::{Duration, Instant};

type AXUIElementRef = *const c_void;
type AXError = i32;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(e: AXUIElementRef, attr: CFStringRef, value: *mut CFTypeRef) -> AXError;
    fn AXUIElementSetAttributeValue(e: AXUIElementRef, attr: CFStringRef, value: CFTypeRef) -> AXError;
    fn AXUIElementPerformAction(e: AXUIElementRef, action: CFStringRef) -> AXError;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
}

struct El(AXUIElementRef);

impl Drop for El {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}

impl Clone for El {
    fn clone(&self) -> Self {
        unsafe { CFRetain(self.0) };
        El(self.0)
    }
}

impl El {
    fn raw(&self, name: &str) -> Option<CFType> {
        let mut v: CFTypeRef = std::ptr::null();
        let attr = CFString::new(name);
        let err = unsafe { AXUIElementCopyAttributeValue(self.0, attr.as_concrete_TypeRef(), &mut v) };
        (err == 0 && !v.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(v) })
    }

    fn text(&self, name: &str) -> String {
        self.raw(name).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string()).unwrap_or_default()
    }

    fn role(&self) -> String {
        self.text("AXRole")
    }

    fn label(&self) -> String {
        let d = self.text("AXDescription");
        if d.is_empty() {
            self.text("AXTitle")
        } else {
            d
        }
    }

    fn children(&self) -> Vec<El> {
        let Some(v) = self.raw("AXChildren") else { return vec![] };
        let Some(arr) = v.downcast::<CFArray>() else { return vec![] };
        arr.iter()
            .map(|p| {
                unsafe { CFRetain(*p) };
                El(*p)
            })
            .collect()
    }

    fn set_bool(&self, name: &str, value: bool) {
        let attr = CFString::new(name);
        let b = if value { CFBoolean::true_value() } else { CFBoolean::false_value() };
        unsafe { AXUIElementSetAttributeValue(self.0, attr.as_concrete_TypeRef(), b.as_CFTypeRef()) };
    }

    fn press(&self) -> bool {
        let a = CFString::new("AXPress");
        unsafe { AXUIElementPerformAction(self.0, a.as_concrete_TypeRef()) == 0 }
    }

    fn parent(&self) -> Option<El> {
        let v = self.raw("AXParent")?;
        let r = v.as_CFTypeRef();
        unsafe { CFRetain(r) };
        Some(El(r))
    }

    fn texts(&self, depth: usize, out: &mut Vec<String>) {
        if depth > 6 {
            return;
        }
        if self.role() == "AXStaticText" {
            out.push(self.text("AXValue"));
        }
        for c in self.children() {
            c.texts(depth + 1, out);
        }
    }
}

fn walk(e: &El, depth: usize, budget: &mut usize, out: &mut Vec<El>, pred: &dyn Fn(&El) -> bool) {
    if depth > 50 || *budget == 0 {
        return;
    }
    *budget -= 1;
    if pred(e) {
        out.push(e.clone());
    }
    for c in e.children() {
        walk(&c, depth + 1, budget, out, pred);
    }
}

fn find_all(root: &El, pred: &dyn Fn(&El) -> bool) -> Vec<El> {
    let mut out = vec![];
    let mut budget = 60_000;
    walk(root, 0, &mut budget, &mut out, pred);
    out
}

fn wait_for<T>(timeout: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let end = Instant::now() + timeout;
    loop {
        if let Some(v) = f() {
            return Some(v);
        }
        if Instant::now() > end {
            return None;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

pub fn trusted(prompt: bool) -> bool {
    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let val = if prompt { CFBoolean::true_value() } else { CFBoolean::false_value() };
    let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), val.as_CFType())]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const c_void) }
}

fn claude_pid() -> Option<i32> {
    let out = Command::new("/bin/ps").args(["-axo", "pid=,comm="]).output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().find_map(|l| {
        let (pid, comm) = l.trim().split_once(' ')?;
        comm.trim().ends_with("/Claude.app/Contents/MacOS/Claude").then(|| pid.parse().ok()).flatten()
    })
}

fn post_text(pid: i32, text: &str) -> Result<(), String> {
    let src = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| "키 입력을 만들지 못했습니다".to_string())?;
    let key = |code: u16, down: bool, flags: CGEventFlags| -> Result<(), String> {
        let e = CGEvent::new_keyboard_event(src.clone(), code, down).map_err(|_| "키 입력을 만들지 못했습니다".to_string())?;
        e.set_flags(flags);
        e.post_to_pid(pid);
        Ok(())
    };
    key(0, true, CGEventFlags::CGEventFlagCommand)?;
    key(0, false, CGEventFlags::CGEventFlagCommand)?;
    std::thread::sleep(Duration::from_millis(80));
    for ch in text.chars() {
        let s = ch.to_string();
        for down in [true, false] {
            let e = CGEvent::new_keyboard_event(src.clone(), 0, down).map_err(|_| "키 입력을 만들지 못했습니다".to_string())?;
            e.set_string(&s);
            e.post_to_pid(pid);
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    Ok(())
}

fn is_search_field(e: &El) -> bool {
    let role = e.role();
    if role != "AXTextField" && role != "AXSearchField" {
        return false;
    }
    let ph = e.text("AXPlaceholderValue").to_lowercase();
    ph.contains("플러그인") || ph.contains("plugin")
}

fn link_named(e: &El, name: &str) -> bool {
    if e.role() != "AXLink" {
        return false;
    }
    let n = name.to_lowercase();
    let l = e.label().to_lowercase();
    l == n || l == format!("{n} 보기") || l == format!("view {n}") || l == format!("{n} view")
}

/// 검색 결과에서 누를 링크를 고른다. 저장소가 표시된 결과는 저장소까지 같아야 하고,
/// 저장소 표시가 없으면 같은 이름이 하나뿐일 때만 고른다 (같은 이름의 다른 플러그인을 잘못 누르지 않게).
fn pick_link(found: Vec<El>, repo: Option<&str>) -> Result<Option<El>, String> {
    let mut exact = Vec::new();
    let mut unlabeled = Vec::new();
    for e in found {
        let mut texts = vec![];
        e.texts(0, &mut texts);
        let repos: Vec<&String> = texts.iter().filter(|t| t.contains('/')).collect();
        match repo {
            Some(r) if repos.iter().any(|t| t.eq_ignore_ascii_case(r)) => exact.push(e),
            Some(_) if repos.is_empty() => unlabeled.push(e),
            Some(_) => {}
            None => unlabeled.push(e),
        }
    }
    if let Some(e) = exact.into_iter().next() {
        return Ok(Some(e));
    }
    match unlabeled.len() {
        0 => Ok(None),
        1 => Ok(unlabeled.pop()),
        _ => Err("같은 이름의 플러그인이 여러 개 있어 자동으로 고르지 않았습니다. Claude 앱 디렉터리에서 직접 골라 주세요.".into()),
    }
}

const ADD: &[&str] = &["추가", "Add"];
const ADDED: &[&str] = &["추가됨", "Added", "설치됨", "Installed"];

enum Page {
    Add(El),
    Added,
}

/// 버튼에서 위로 올라가며, 가까운 조상 영역에 플러그인 이름이 제목처럼 적혀 있는지 본다.
fn near_name(e: &El, name: &str) -> bool {
    let mut cur = e.parent();
    for _ in 0..6 {
        let Some(p) = cur else { return false };
        let mut texts = vec![];
        p.texts(0, &mut texts);
        if texts.iter().any(|t| t.trim().eq_ignore_ascii_case(name)) {
            return true;
        }
        cur = p.parent();
    }
    false
}

/// 플러그인 상세 화면의 "추가" 버튼(또는 이미 추가됨 표시)을 찾는다.
/// 이름 근처에 있는 버튼만 인정하고, 후보가 정확히 하나일 때만 누른다.
fn detail_page(root: &El, name: &str) -> Result<Option<Page>, String> {
    let hits = find_all(root, &|e| match e.role().as_str() {
        "AXButton" => {
            let l = e.label();
            ADD.contains(&l.as_str()) || ADDED.contains(&l.as_str())
        }
        "AXStaticText" => ADDED.contains(&e.text("AXValue").as_str()),
        _ => false,
    });
    let near: Vec<El> = hits.into_iter().filter(|e| near_name(e, name)).collect();
    if near.iter().any(|e| e.role() == "AXStaticText" || ADDED.contains(&e.label().as_str())) {
        return Ok(Some(Page::Added));
    }
    match near.len() {
        0 => Ok(None),
        1 => Ok(near.into_iter().next().map(Page::Add)),
        _ => Err("추가 버튼이 여러 개라 자동으로 누르지 않았습니다. Claude 앱에서 직접 추가해 주세요.".into()),
    }
}

/// wait_for와 같지만, 판정 중 오류가 나면 바로 멈춘다.
fn wait_result<T>(timeout: Duration, mut f: impl FnMut() -> Result<Option<T>, String>) -> Result<Option<T>, String> {
    let end = Instant::now() + timeout;
    loop {
        if let Some(v) = f()? {
            return Ok(Some(v));
        }
        if Instant::now() > end {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

pub enum Outcome {
    Added,
    AlreadyAdded,
}

pub fn install(name: &str, repo: Option<&str>, open_directory: impl Fn() -> Result<(), String>) -> Result<Outcome, String> {
    if !trusted(true) {
        return Err("NEEDS_ACCESSIBILITY".into());
    }
    open_directory()?;
    let pid = wait_for(Duration::from_secs(20), claude_pid).ok_or("Claude 앱이 열리지 않았습니다.")?;
    let app = El(unsafe { AXUIElementCreateApplication(pid) });
    app.set_bool("AXManualAccessibility", true);

    let field = wait_for(Duration::from_secs(20), || find_all(&app, &is_search_field).into_iter().next())
        .ok_or("Claude 앱 디렉터리의 검색창을 찾지 못했습니다.")?;
    field.set_bool("AXFocused", true);
    std::thread::sleep(Duration::from_millis(300));
    post_text(pid, name)?;

    let link = wait_result(Duration::from_secs(15), || pick_link(find_all(&app, &|e| link_named(e, name)), repo))?
        .ok_or_else(|| format!("Claude 앱 검색 결과에서 '{name}'을(를) 찾지 못했습니다."))?;
    if !link.press() {
        return Err("검색 결과를 열지 못했습니다.".into());
    }
    // 화면이 상세 페이지로 넘어갈 때까지(검색 결과 링크가 사라질 때까지) 기다린 뒤에 버튼을 찾는다.
    let _ = wait_for(Duration::from_secs(10), || find_all(&app, &|e| link_named(e, name)).is_empty().then_some(()));

    let button = match wait_result(Duration::from_secs(15), || detail_page(&app, name))?.ok_or("플러그인 화면에서 추가 버튼을 찾지 못했습니다.")? {
        Page::Added => return Ok(Outcome::AlreadyAdded),
        Page::Add(b) => b,
    };
    if !button.press() {
        return Err("추가 버튼을 누르지 못했습니다.".into());
    }
    let confirmed = wait_for(Duration::from_secs(15), || matches!(detail_page(&app, name), Ok(Some(Page::Added))).then_some(()));
    if confirmed.is_none() {
        return Err("추가 버튼을 눌렀지만 완료 표시가 나오지 않았습니다. Claude 앱에 확인 창이 떴는지 봐 주세요.".into());
    }
    Ok(Outcome::Added)
}
