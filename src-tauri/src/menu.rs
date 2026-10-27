use crate::native_navigation::{self, Action};
use tauri::{
    App,
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem},
};

pub fn install(app: &App) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let submenus: Vec<_> = menu
        .items()?
        .into_iter()
        .filter_map(|item| item.as_submenu().cloned())
        .collect();
    let app_menu = submenus
        .first()
        .ok_or_else(|| std::io::Error::other("missing application menu"))?;
    app_menu.set_text("IceKube")?;
    let original_about = app_menu
        .items()?
        .into_iter()
        .next()
        .ok_or_else(|| std::io::Error::other("missing About item"))?;
    app_menu.remove(&original_about)?;
    app_menu.prepend(&PredefinedMenuItem::about(
        app,
        Some("About IceKube"),
        Some(AboutMetadata {
            name: Some("IceKube".into()),
            version: Some(app.package_info().version.to_string()),
            authors: Some(vec!["Yanuar".into()]),
            credits: Some("Created by Yanuar".into()),
            icon: app.default_window_icon().cloned(),
            ..Default::default()
        }),
    )?)?;
    let preferences = MenuItem::with_id(
        app,
        "preferences",
        "Preferences…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    app_menu.insert_items(&[&preferences, &PredefinedMenuItem::separator(app)?], 2)?;
    let file = submenus
        .iter()
        .find(|submenu| submenu.text().ok().as_deref() == Some("File"))
        .ok_or_else(|| std::io::Error::other("missing File menu"))?;
    file.prepend(&MenuItem::with_id(
        app,
        "native-new-window",
        "New Window",
        true,
        Some("CmdOrCtrl+N"),
    )?)?;
    let help = submenus
        .iter()
        .find(|submenu| submenu.text().ok().as_deref() == Some("Help"))
        .ok_or_else(|| std::io::Error::other("missing Help menu"))?;
    help.append_items(&[
        &MenuItem::with_id(
            app,
            "native-search",
            "Search Icekube",
            true,
            Some("CmdOrCtrl+K"),
        )?,
        &MenuItem::with_id(
            app,
            "native-all-categories",
            "All Categories",
            true,
            None::<&str>,
        )?,
        &MenuItem::with_id(app, "native-homepage", "Homepage", true, None::<&str>)?,
        &MenuItem::with_id(
            app,
            "native-check-updates",
            "Check for Updates…",
            true,
            None::<&str>,
        )?,
    ])?;
    app.set_menu(menu)?;
    help.set_as_help_menu_for_nsapp()?;
    app.on_menu_event(|app, event| {
        let result = match event.id().as_ref() {
            "preferences" => native_navigation::dispatch(app, Action::OpenPreferences),
            "native-new-window" => crate::window::new_window(app).map(|_| ()),
            "native-all-categories" => native_navigation::dispatch(app, Action::AllCategories),
            "native-search" => native_navigation::dispatch(app, Action::OpenSearch),
            "native-check-updates" => native_navigation::dispatch(app, Action::CheckUpdates),
            "native-homepage" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::project::project_open_homepage(app).await;
                });
                Ok(())
            }
            _ => Ok(()),
        };
        if result.is_err() {
            eprintln!("Could not complete the application menu action.");
        }
    });
    Ok(())
}
