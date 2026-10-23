mod catalog;
mod window;

use catalog::{
    AddWebLinkRequest, CatalogEngine, CatalogError, CatalogSnapshot, ImportRequest, PinRequest,
    RemoveRequest,
};
use std::sync::Arc;
use tauri::Manager;

async fn catalog_operation(
    engine: Arc<CatalogEngine>,
    operation: impl FnOnce(&CatalogEngine) -> Result<CatalogSnapshot, CatalogError> + Send + 'static,
) -> Result<CatalogSnapshot, CatalogError> {
    tauri::async_runtime::spawn_blocking(move || operation(&engine))
        .await
        .map_err(|_| CatalogError::StoreUnavailable)?
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
            app.manage(Arc::new(CatalogEngine::new(app.path().app_data_dir()?)));
            window::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            catalog_list,
            catalog_import_kubeconfig,
            catalog_add_web_link,
            catalog_set_pin,
            catalog_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
