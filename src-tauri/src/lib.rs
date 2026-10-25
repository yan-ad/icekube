mod catalog;
mod connection;
mod window;

use catalog::{
    AddWebLinkRequest, CatalogEngine, CatalogError, CatalogSnapshot, ImportRequest,
    OpenWebLinkRequest, PinRequest, RemoveRequest,
};
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

async fn catalog_operation(
    engine: Arc<CatalogEngine>,
    operation: impl FnOnce(&CatalogEngine) -> Result<CatalogSnapshot, CatalogError> + Send + 'static,
) -> Result<CatalogSnapshot, CatalogError> {
    tauri::async_runtime::spawn_blocking(move || operation(&engine))
        .await
        .map_err(|_| CatalogError::StoreUnavailable)?
}

#[tauri::command]
async fn helm_table(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::helm::HelmRequest,
) -> Result<connection::helm::HelmPage, connection::ConnectionError> {
    connections.helm_table(request).await
}

#[tauri::command]
fn helm_cancel(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::helm::HelmCancelRequest,
) -> Result<(), connection::ConnectionError> {
    connections.helm_cancel(request)
}

#[tauri::command]
async fn cluster_pod_detail(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pods::PodRequest,
) -> Result<connection::pods::PodDetails, connection::ConnectionError> {
    connections.pod_detail(request).await
}

#[tauri::command]
async fn cluster_pod_mutate(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pods::PodMutationRequest,
) -> Result<(), connection::ConnectionError> {
    connections.pod_mutate(request).await
}

#[tauri::command]
async fn cluster_pod_stream_open(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodStartRequest,
) -> Result<connection::pod_runtime::PodStreamSnapshot, connection::ConnectionError> {
    connections.pod_stream_open(request).await
}

#[tauri::command]
fn cluster_pod_stream_read(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodStreamRequest,
) -> Result<connection::pod_runtime::PodStreamSnapshot, connection::ConnectionError> {
    connections.pod_stream_read(request)
}

#[tauri::command]
fn cluster_pod_stream_close(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodStreamRequest,
) -> Result<(), connection::ConnectionError> {
    connections.pod_stream_close(request)
}

#[tauri::command]
fn cluster_pod_stream_write(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodInputRequest,
) -> Result<(), connection::ConnectionError> {
    connections.pod_stream_write(request)
}

#[tauri::command]
fn cluster_pod_stream_resize(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodResizeRequest,
) -> Result<(), connection::ConnectionError> {
    connections.pod_stream_resize(request)
}

#[tauri::command]
async fn cluster_pod_forward_start(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodForwardRequest,
) -> Result<connection::pod_runtime::PodForward, connection::ConnectionError> {
    connections.pod_forward_start(request).await
}

#[tauri::command]
fn cluster_pod_forward_list(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::SessionRequest,
) -> Result<Vec<connection::pod_runtime::PodForward>, connection::ConnectionError> {
    connections.pod_forward_list(request)
}

#[tauri::command]
fn cluster_pod_forward_stop(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_runtime::PodForwardStopRequest,
) -> Result<(), connection::ConnectionError> {
    connections.pod_forward_stop(request)
}

#[tauri::command]
fn cluster_pod_sync_open(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::ResourceRequest,
) -> Result<connection::pod_sync::PodSyncSnapshot, connection::ConnectionError> {
    connections.pod_sync_open(request)
}

#[tauri::command]
fn cluster_pod_sync_read(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_sync::PodSyncRequest,
) -> Result<connection::pod_sync::PodSyncSnapshot, connection::ConnectionError> {
    connections.pod_sync_read(request)
}

#[tauri::command]
fn cluster_pod_sync_close(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::pod_sync::PodSyncRequest,
) -> Result<(), connection::ConnectionError> {
    connections.pod_sync_close(request)
}

#[tauri::command]
async fn cluster_session_open(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::OpenRequest,
) -> Result<connection::ConnectionSnapshot, connection::ConnectionError> {
    connections.open(request).await
}

#[tauri::command]
async fn cluster_connect(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::SessionRequest,
) -> Result<connection::ConnectionSnapshot, connection::ConnectionError> {
    connections.connect(request).await
}

#[tauri::command]
async fn cluster_disconnect(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::SessionRequest,
) -> Result<(), connection::ConnectionError> {
    connections.disconnect(request)
}

#[tauri::command]
fn cluster_connection_status(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::SessionRequest,
) -> Result<connection::ConnectionSnapshot, connection::ConnectionError> {
    connections.status(request)
}

#[tauri::command]
async fn cluster_resources(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::ResourceRequest,
) -> Result<connection::ResourcePage, connection::ConnectionError> {
    connections.resources(request).await
}

#[tauri::command]
fn cluster_resources_cancel(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::ResourceRequest,
) -> Result<(), connection::ConnectionError> {
    connections.cancel_resources(request)
}

#[tauri::command]
async fn catalog_open_web_link(
    app: tauri::AppHandle,
    engine: tauri::State<'_, Arc<CatalogEngine>>,
    request: OpenWebLinkRequest,
) -> Result<(), CatalogError> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        engine.open_web_link_with(request, |url| app.opener().open_url(url, None::<&str>))
    })
    .await
    .map_err(|_| CatalogError::OpenFailed)?
}

#[tauri::command]
async fn catalog_list(
    engine: tauri::State<'_, Arc<CatalogEngine>>,
) -> Result<CatalogSnapshot, CatalogError> {
    catalog_operation(engine.inner().clone(), CatalogEngine::list).await
}

#[tauri::command]
async fn catalog_import_kubeconfig(
    engine: tauri::State<'_, Arc<CatalogEngine>>,
    request: ImportRequest,
) -> Result<CatalogSnapshot, CatalogError> {
    catalog_operation(engine.inner().clone(), move |engine| {
        engine.import_kubeconfig(request)
    })
    .await
}

#[tauri::command]
async fn catalog_add_web_link(
    engine: tauri::State<'_, Arc<CatalogEngine>>,
    request: AddWebLinkRequest,
) -> Result<CatalogSnapshot, CatalogError> {
    catalog_operation(engine.inner().clone(), move |engine| {
        engine.add_web_link(request)
    })
    .await
}

#[tauri::command]
async fn catalog_set_pin(
    engine: tauri::State<'_, Arc<CatalogEngine>>,
    request: PinRequest,
) -> Result<CatalogSnapshot, CatalogError> {
    catalog_operation(engine.inner().clone(), move |engine| {
        engine.set_pin(request)
    })
    .await
}

#[tauri::command]
async fn catalog_remove(
    engine: tauri::State<'_, Arc<CatalogEngine>>,
    request: RemoveRequest,
) -> Result<CatalogSnapshot, CatalogError> {
    catalog_operation(engine.inner().clone(), move |engine| engine.remove(request)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let catalog = Arc::new(CatalogEngine::new_with_home(
                app.path().app_data_dir()?,
                app.path().home_dir().ok(),
            ));
            app.manage(catalog.clone());
            app.manage(Arc::new(connection::ConnectionEngine::new(catalog)));
            window::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog_list,
            catalog_import_kubeconfig,
            catalog_add_web_link,
            catalog_set_pin,
            catalog_remove,
            catalog_open_web_link,
            cluster_session_open,
            cluster_connect,
            cluster_disconnect,
            cluster_connection_status,
            cluster_resources,
            cluster_resources_cancel,
            cluster_pod_detail,
            cluster_pod_mutate,
            cluster_pod_stream_open,
            cluster_pod_stream_read,
            cluster_pod_stream_close,
            cluster_pod_stream_write,
            cluster_pod_stream_resize,
            cluster_pod_forward_start,
            cluster_pod_forward_list,
            cluster_pod_forward_stop,
            cluster_pod_sync_open,
            cluster_pod_sync_read,
            cluster_pod_sync_close,

            helm_table,
            helm_cancel
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. })
                || matches!(event, tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } if label == "main")
            {
                let engine = app.state::<Arc<connection::ConnectionEngine>>();
                engine.shutdown();
                tauri::async_runtime::block_on(engine.drain());
            }
        });
}
