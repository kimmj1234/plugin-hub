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

fn link_matches(e: &El, name: &str, repo: Option<&str>) -> bool {
    if e.role() != "AXLink" {
        return false;
    }
    let label = e.label();
    let n = name.to_lowercase();
    let l = label.to_lowercase();
    let named = l == n || l == format!("{n} 보기") || l == format!("view {n}") || l == format!("{n} view");
    if !named {
        return false;
    }
    let Some(repo) = repo else { return true };
    let mut texts = vec![];
    e.texts(0, &mut texts);
    texts.iter().any(|t| t.eq_ignore_ascii_case(repo)) || !texts.iter().any(|t| t.contains('/'))
}

const ADD: &[&str] = &["추가", "Add"];
const ADDED: &[&str] = &["추가됨", "Added", "설치됨", "Installed"];

enum Page {
    Add(El),
    Added,
}

fn detail_page(root: &El) -> Option<Page> {
    let hits = find_all(root, &|e| match e.role().as_str() {
        "AXButton" => {
            let l = e.label();
            ADD.contains(&l.as_str()) || ADDED.contains(&l.as_str())
        }
        "AXStaticText" => ADDED.contains(&e.text("AXValue").as_str()),
        _ => false,
    });
    if hits.iter().any(|e| e.role() == "AXStaticText" || ADDED.contains(&e.label().as_str())) {
        return Some(Page::Added);
    }
    hits.into_iter().next().map(Page::Add)
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

    let link = wait_for(Duration::from_secs(15), || {
        let found = find_all(&app, &|e| link_matches(e, name, repo));
        (found.len() >= 1).then(|| found.into_iter().next()).flatten()
    })
    .ok_or_else(|| format!("Claude 앱 검색 결과에서 '{name}'을(를) 찾지 못했습니다."))?;
    if !link.press() {
        return Err("검색 결과를 열지 못했습니다.".into());
    }

    let button = match wait_for(Duration::from_secs(15), || detail_page(&app)).ok_or("플러그인 화면에서 추가 버튼을 찾지 못했습니다.")? {
        Page::Added => return Ok(Outcome::AlreadyAdded),
        Page::Add(b) => b,
    };
    if !button.press() {
        return Err("추가 버튼을 누르지 못했습니다.".into());
    }
    let confirmed = wait_for(Duration::from_secs(15), || matches!(detail_page(&app), Some(Page::Added)).then_some(()));
    if confirmed.is_none() {
        return Err("추가 버튼을 눌렀지만 완료 표시가 나오지 않았습니다. Claude 앱에 확인 창이 떴는지 봐 주세요.".into());
    }
    Ok(Outcome::Added)
}
