use tauri_plugin_dialog::{DialogExt, FilePath};

#[derive(Debug, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PickerError {
    DialogFailed,
}

fn selected_path(selection: Option<FilePath>) -> Result<Option<String>, PickerError> {
    match selection {
        None => Ok(None),
        Some(FilePath::Path(path)) if path.is_absolute() => path
            .into_os_string()
            .into_string()
            .map(Some)
            .map_err(|_| PickerError::DialogFailed),
        Some(_) => Err(PickerError::DialogFailed),
    }
}

#[tauri::command]
pub async fn catalog_choose_kubeconfig(
    window: tauri::WebviewWindow,
) -> Result<Option<String>, PickerError> {
    if window.label() != "main" {
        return Err(PickerError::DialogFailed);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = window.dialog().file().set_title("Choose kubeconfig");
        #[cfg(desktop)]
        let dialog = dialog.set_parent(&window);
        selected_path(dialog.blocking_pick_file())
    })
    .await
    .map_err(|_| PickerError::DialogFailed)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn cancel_and_selected_paths_do_not_read_or_resolve_files() {
        assert_eq!(selected_path(None), Ok(None));
        let path = std::env::temp_dir().join("未存在 kubeconfig link");
        assert_eq!(
            selected_path(Some(FilePath::Path(path.clone()))),
            Ok(Some(path.to_str().unwrap().to_owned()))
        );
    }

    #[test]
    fn rejects_relative_paths_and_urls() {
        assert_eq!(
            selected_path(Some(FilePath::Path(PathBuf::from("config")))),
            Err(PickerError::DialogFailed)
        );
        assert_eq!(
            selected_path(Some(FilePath::Url(
                url::Url::parse("file:///tmp/config").unwrap()
            ))),
            Err(PickerError::DialogFailed)
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_utf8_without_lossy_path_conversion() {
        use std::os::unix::ffi::OsStringExt;
        assert_eq!(
            selected_path(Some(FilePath::Path(PathBuf::from(
                std::ffi::OsString::from_vec(b"/tmp/\xff".to_vec())
            )))),
            Err(PickerError::DialogFailed)
        );
    }
}
