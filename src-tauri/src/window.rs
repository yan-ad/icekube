use serde::Serialize;
use tauri::{App, WebviewWindowBuilder};

const SEAMLESS: bool = true;

#[derive(Serialize)]
struct WindowLayout {
    seamless: bool,
    platform: &'static str,
}

fn layout_script(seamless: bool, platform: &'static str) -> serde_json::Result<String> {
    let layout = serde_json::to_string(&WindowLayout { seamless, platform })?;
    Ok(format!(
        "Object.defineProperty(window, '__ICEKUBE_WINDOW_LAYOUT__', {{ value: Object.freeze({layout}), writable: false, configurable: false }});"
    ))
}

pub fn create_main_window(app: &App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("main window configuration is required");
    let builder = WebviewWindowBuilder::from_config(app, config)?
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

    builder.build()?;
    Ok(())
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
