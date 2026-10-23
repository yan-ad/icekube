// Copyright (c) Freelens Authors. All rights reserved.
// Licensed under MIT License. See LICENSE in root directory for more information.

mod backend;

use backend::{Backend, BackendStatus, CatalogSnapshot, PodsRequest, PodsSnapshot};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, State, WebviewUrl, WebviewWindow};

type SharedBackend = Arc<Mutex<Backend>>;

struct SmokeTest(bool);

fn check_caller(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|error| error.to_string())?;
    eprintln!("Tauri runtime command from {url}");
    if window.label() != "main" || !is_runtime_url(&url) {
        return Err("Runtime command denied for this webview".into());
    }
    Ok(())
}

fn is_runtime_url(url: &tauri::Url) -> bool {
    let expected_origin = if cfg!(target_os = "windows") {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost")
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost")
    };
    expected_origin
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "" | "/" | "/index.html")
        && url.query().is_none()
}

#[tauri::command]
async fn runtime_status(
    window: WebviewWindow,
    backend: State<'_, SharedBackend>,
) -> Result<BackendStatus, String> {
    check_caller(&window)?;
    let backend = backend.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend.lock().map_err(|error| error.to_string())?.status()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn catalog_snapshot(
    window: WebviewWindow,
    backend: State<'_, SharedBackend>,
) -> Result<CatalogSnapshot, String> {
    check_caller(&window)?;
    let backend = backend.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend
            .lock()
            .map_err(|error| error.to_string())?
            .catalog_snapshot()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pods_list(
    window: WebviewWindow,
    backend: State<'_, SharedBackend>,
    request: PodsRequest,
) -> Result<PodsSnapshot, String> {
    check_caller(&window)?;
    request.validate()?;
    let backend = backend.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        backend
            .lock()
            .map_err(|_| "Pods backend unavailable".to_string())?
            .list_pods(request)
    })
    .await
    .map_err(|_| "Pods backend unavailable".to_string())?
}

#[tauri::command]
fn window_drag(window: WebviewWindow) -> Result<(), String> {
    check_caller(&window)?;
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    check_caller(&window)?;
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn runtime_ready(window: WebviewWindow, smoke: State<'_, SmokeTest>) -> Result<(), String> {
    check_caller(&window)?;
    if smoke.0 {
        let url = window.url().map_err(|error| error.to_string())?;
        if url
            .fragment()
            .is_some_and(|fragment| fragment.starts_with("/cluster/"))
        {
            println!("TAURI_PODS_PAGE_READY");
            window.app_handle().exit(0);
        } else if url.fragment() == Some("/catalog") {
            println!("TAURI_CATALOG_READY");
            window.eval("document.querySelector('[data-catalog-kind=\"KubernetesCluster\"] [aria-label^=\"Open \"]').click()")
                .map_err(|error| error.to_string())?;
        } else {
            window
                .eval("window.location.hash = '/catalog'")
                .map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    println!("TAURI_WEBVIEW_READY");
    Ok(())
}

fn required_path(name: &str) -> Result<PathBuf, String> {
    std::env::var_os(name)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| format!("{name} must be set to an absolute path; use pnpm dev:tauri"))
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let node = required_path("FREELENS_TAURI_NODE")?;
    let script = required_path("FREELENS_TAURI_BACKEND")?;
    let profile = required_path("FREELENS_TAURI_PROFILE")?;
    let mut backend = Backend::start(&node, &script, &profile)?;
    let smoke = std::env::args().any(|arg| arg == "--smoke-test");

    if std::env::args().any(|arg| arg == "--check-backend") {
        println!("{}", serde_json::to_string(&backend.status()?)?);
        backend.stop();
        return Ok(());
    }

    let backend = Arc::new(Mutex::new(backend));
    let cleanup = backend.clone();
    let app = tauri::Builder::default()
        .manage(backend)
        .manage(SmokeTest(smoke))
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            catalog_snapshot,
            pods_list,
            window_drag,
            window_toggle_maximize,
            runtime_ready
        ])
        .on_page_load(|_, payload| eprintln!("Tauri runtime page: {}", payload.url()))
        .setup(move |app| {
            let data_directory = profile.join("webview");
            std::fs::create_dir_all(&data_directory)?;
            let window =
                tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Freelens")
                    .inner_size(900.0, 600.0)
                    .min_inner_size(700.0, 500.0)
                    .data_directory(data_directory)
                    .on_navigation(|url| {
                        let allowed = is_runtime_url(url);
                        eprintln!("Tauri runtime navigation: {url} allowed={allowed}");
                        allowed
                    });
            #[cfg(target_os = "macos")]
            let window = window
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(14.0, 18.0));
            window.build()?;
            if smoke {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(15));
                    eprintln!("Tauri webview readiness timed out");
                    handle.exit(1);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())?;

    app.run(move |_, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Ok(mut backend) = cleanup.lock() {
                backend.stop();
            }
        }
    });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Tauri development runtime failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_is_restricted_to_the_embedded_document() {
        let allowed = if cfg!(target_os = "windows") {
            "http://tauri.localhost/index.html"
        } else {
            "tauri://localhost/index.html"
        };
        assert!(is_runtime_url(&allowed.parse().unwrap()));
        let root = allowed.strip_suffix("/index.html").unwrap();
        assert!(is_runtime_url(&root.parse().unwrap()));
        assert!(is_runtime_url(&format!("{root}/").parse().unwrap()));
        for denied in [
            "https://example.com/index.html",
            "tauri://localhost/other.html",
            "tauri://localhost/index.html?remote=1",
            "https://tauri.localhost.example.com/index.html",
            "file:///index.html",
            "http://tauri.localhost:8080/index.html",
            "tauri://localhost:8080/index.html",
            "tauri://user@localhost/index.html",
        ] {
            assert!(!is_runtime_url(&denied.parse().unwrap()));
        }
    }
}
