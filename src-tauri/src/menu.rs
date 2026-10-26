use tauri::{
    App, Emitter, EventTarget, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem},
};

const PREFERENCES_ID: &str = "preferences";
const OPEN_PREFERENCES_EVENT: &str = "icekube://open-preferences";

pub fn install(app: &App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let app_menu = menu
        .items()?
        .into_iter()
        .find_map(|item| item.as_submenu().cloned())
        .ok_or_else(|| std::io::Error::other("missing application menu"))?;

    app_menu.set_text(app.config().product_name.as_deref().unwrap_or("IceKube"))?;
    let preferences = MenuItem::with_id(
        app,
        PREFERENCES_ID,
        "Preferences…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    // The default app menu starts with About and a separator, followed by Services.
    app_menu.insert_items(&[&preferences, &PredefinedMenuItem::separator(app)?], 2)?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        if event.id().as_ref() != PREFERENCES_ID {
            return;
        }
        if let Some(window) = app.get_webview_window("main") {
            let result = window
                .unminimize()
                .and_then(|()| window.show())
                .and_then(|()| window.set_focus())
                .and_then(|()| {
                    app.emit_to(
                        EventTarget::webview_window("main"),
                        OPEN_PREFERENCES_EVENT,
                        (),
                    )
                });
            if result.is_err() {
                eprintln!("Could not open Preferences from the application menu.");
            }
        }
    });
    Ok(())
}
