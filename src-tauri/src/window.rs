use serde::Serialize;
use tauri::{App, AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

const SEAMLESS: bool = true;

#[derive(Serialize)]
struct WindowLayout {
    seamless: bool,
    platform: &'static str,
}

pub fn create_main_window_handle(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    create_window(app, "main")
}

fn layout_script(seamless: bool, platform: &'static str) -> serde_json::Result<String> {
    let layout = serde_json::to_string(&WindowLayout { seamless, platform })?;
    Ok(format!(
        "Object.defineProperty(window, '__ICEON_WINDOW_LAYOUT__', {{ value: Object.freeze({layout}), writable: false, configurable: false }});"
    ))
}

pub fn create_main_window(app: &App) -> tauri::Result<()> {
    create_window(app.handle(), "main")?;
    Ok(())
}

pub fn new_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let label = (1..8)
        .map(|index| format!("iceon-{index}"))
        .find(|label| app.get_webview_window(label).is_none())
        .ok_or_else(|| std::io::Error::other("The eight-window limit has been reached."))?;
    create_window(app, &label)
}

fn create_window(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("main window configuration is required");
    let mut config = config.clone();
    config.label = label.to_owned();
    let builder = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(layout_script(SEAMLESS, std::env::consts::OS)?);

    #[cfg(target_os = "macos")]
    let builder = if SEAMLESS {
        builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
    } else {
        builder
    };

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(!SEAMLESS);

    crate::native_navigation::register_window(app, label);
    let result = builder.build();
    if result.is_err() {
        crate::native_navigation::forget_window(app, label);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_metadata_matches_native_mode() {
        for seamless in [true, false] {
            for platform in ["macos", "windows", "linux"] {
                let script = layout_script(seamless, platform).unwrap();
                assert!(script.contains(&format!("\"seamless\":{seamless}")));
                assert!(script.contains(&format!("\"platform\":\"{platform}\"")));
                assert!(script.contains("Object.freeze("));
                assert!(script.contains("writable: false, configurable: false"));
            }
        }
    }
}
