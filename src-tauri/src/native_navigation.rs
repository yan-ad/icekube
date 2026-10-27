use serde::Serialize;
use std::{collections::HashMap, sync::Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

pub const EVENT: &str = "icekube://native-navigation";
const TRAY_ID: &str = "icekube-navigation";

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    AllCategories,
    OpenSearch,
    OpenPreferences,
    CheckUpdates,
}

#[derive(Default)]
pub struct Navigation {
    pending: Mutex<HashMap<String, Vec<Action>>>,
}

pub fn focused_or_create(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let windows = app.webview_windows();
    let window = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .cloned()
        .or_else(|| windows.get("main").cloned())
        .or_else(|| windows.values().next().cloned());
    let window = match window {
        Some(window) => window,
        None => crate::window::create_main_window_handle(app)?,
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()?;
    Ok(window)
}

pub fn dispatch(app: &AppHandle, action: Action) -> tauri::Result<()> {
    let window = focused_or_create(app)?;
    let navigation = app.state::<Navigation>();
    let mut pending = navigation.pending.lock().unwrap();
    if let Some(queue) = pending.get_mut(window.label()) {
        if queue.len() < 8 {
            queue.push(action);
        }
        return Ok(());
    }
    app.emit_to(EventTarget::webview_window(window.label()), EVENT, action)
}

pub fn register_window(app: &AppHandle, label: &str) {
    app.state::<Navigation>()
        .pending
        .lock()
        .unwrap()
        .insert(label.to_owned(), Vec::new());
}

pub fn forget_window(app: &AppHandle, label: &str) {
    app.state::<Navigation>()
        .pending
        .lock()
        .unwrap()
        .remove(label);
}

#[tauri::command]
pub fn native_navigation_ready(
    window: WebviewWindow,
    state: tauri::State<'_, Navigation>,
) -> tauri::Result<()> {
    if let Some(actions) = state.pending.lock().unwrap().remove(window.label()) {
        for action in actions {
            window.emit_to(EventTarget::webview_window(window.label()), EVENT, action)?;
        }
    }
    Ok(())
}

pub fn install(app: &App) -> tauri::Result<()> {
    let all = MenuItem::with_id(
        app,
        "tray-all-categories",
        "All Categories",
        true,
        None::<&str>,
    )?;
    let new = MenuItem::with_id(app, "tray-new-window", "New Window", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &all,
            &new,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let icon = app
        .default_window_icon()
        .ok_or_else(|| std::io::Error::other("missing application icon"))?
        .clone();
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("IceKube")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let result = match event.id().as_ref() {
                "tray-all-categories" => dispatch(app, Action::AllCategories),
                "tray-new-window" => crate::window::new_window(app).map(|_| ()),
                _ => Ok(()),
            };
            if result.is_err() {
                eprintln!("Could not complete native navigation.");
            }
        })
        .build(app)?;
    sync_tray(app.handle())
}

pub fn sync_tray(app: &AppHandle) -> tauri::Result<()> {
    let enabled = app
        .state::<std::sync::Arc<crate::preferences::PreferencesEngine>>()
        .snapshot()
        .map(|snapshot| snapshot.preferences.app.show_tray_icon)
        .unwrap_or(false);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(enabled)?;
    }
    Ok(())
}
