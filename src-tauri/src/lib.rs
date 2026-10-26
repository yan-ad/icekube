mod catalog;
mod connection;
mod preferences;
mod updates;
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
async fn helm_install(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::helm::install::HelmInstallRequest,
) -> Result<connection::helm::install::HelmInstallResult, connection::ConnectionError> {
    connections.helm_install(request).await
}

#[tauri::command]
fn helm_install_cancel(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::helm::install::HelmInstallCancelRequest,
) -> Result<(), connection::ConnectionError> {
    connections.helm_install_cancel(request)
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
async fn cluster_resource_delete(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::delete::DeleteRequest,
) -> Result<connection::delete::DeleteResult, connection::ConnectionError> {
    connections.delete(request).await
}

#[tauri::command]
fn cluster_resource_delete_cancel(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::delete::DeleteCancelRequest,
) -> Result<(), connection::ConnectionError> {
    connections.cancel_delete(request)
}

#[tauri::command]
async fn cluster_resource_create(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::create::CreateRequest,
) -> Result<connection::create::CreateResult, connection::ConnectionError> {
    connections.create(request).await
}

#[tauri::command]
fn cluster_resource_create_cancel(
    connections: tauri::State<'_, Arc<connection::ConnectionEngine>>,
    request: connection::create::CreateCancelRequest,
) -> Result<(), connection::ConnectionError> {
    connections.cancel_create(request)
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

#[tauri::command]
async fn preferences_get(
    engine: tauri::State<'_, Arc<preferences::PreferencesEngine>>,
) -> Result<preferences::PreferencesSnapshot, preferences::PreferencesError> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.snapshot())
        .await
        .map_err(|_| preferences::PreferencesError::StoreUnavailable)?
}

#[tauri::command]
async fn preferences_save(
    engine: tauri::State<'_, Arc<preferences::PreferencesEngine>>,
    request: preferences::SavePreferencesRequest,
) -> Result<preferences::PreferencesSnapshot, preferences::PreferencesError> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.save(request))
        .await
        .map_err(|_| preferences::PreferencesError::StoreUnavailable)?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let catalog = Arc::new(CatalogEngine::new_with_home(
                app_data.clone(),
                app.path().home_dir().ok(),
            ));
            app.manage(catalog.clone());
            app.manage(Arc::new(connection::ConnectionEngine::new(catalog)));

            let prefs = preferences::PreferencesEngine::new(app_data)
                .map_err(|e| format!("preferences init failed: {e:?}"))?;
            app.manage(prefs.clone());

            let proxy = prefs.snapshot().ok().and_then(|s| {
                if s.preferences.proxy.https_proxy.is_empty() {
                    None
                } else {
                    Some(s.preferences.proxy.https_proxy)
                }
            });
            let updater = updates::UpdateEngine::start_with_proxy(app.handle().clone(), proxy.as_deref());
            app.manage(updater);

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
            cluster_resource_create,
            cluster_resource_create_cancel,
            cluster_resource_delete,
            cluster_resource_delete_cancel,
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

            helm_install,
            helm_install_cancel,
            helm_table,
            helm_cancel,

            preferences_get,
            preferences_save,
            updates::update_state,
            updates::update_restart
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
                let updater = app.state::<Arc<updates::UpdateEngine>>();
                updater.shutdown();
                tauri::async_runtime::block_on(updater.drain());
            }
        });
}
