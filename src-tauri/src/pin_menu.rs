use crate::catalog::{CatalogEngine, CatalogError, PinTarget};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
};
use tokio::sync::oneshot;

const LIFETIME: Duration = Duration::from_secs(30);
type Reply = Result<Option<PinMenuAction>, CatalogError>;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PinMenuAction {
    Unpin,
    MoveUp,
    MoveDown,
}
impl PinMenuAction {
    fn label(self) -> &'static str {
        match self {
            Self::Unpin => "Unpin",
            Self::MoveUp => "Move up",
            Self::MoveDown => "Move down",
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShowRequest {
    request_id: String,
    target: PinTarget,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelRequest {
    request_id: String,
}

struct Pending<M> {
    request_id: String,
    token: String,
    sender: oneshot::Sender<Reply>,
    menu: Option<M>,
}
struct Slots<M>(HashMap<String, Pending<M>>);
impl<M> Default for Slots<M> {
    fn default() -> Self {
        Self(HashMap::new())
    }
}
impl<M> Slots<M> {
    fn replace(&mut self, window: String, pending: Pending<M>) {
        if let Some(old) = self.0.insert(window, pending) {
            let _ = old.sender.send(Ok(None));
        }
    }
    fn take(&mut self, window: &str, request: &str, token: Option<&str>) -> Option<Pending<M>> {
        if self
            .0
            .get(window)
            .is_some_and(|p| p.request_id == request && token.is_none_or(|t| p.token == t))
        {
            self.0.remove(window)
        } else {
            None
        }
    }
}
#[derive(Default)]
pub struct PinMenus(Mutex<Slots<Menu<tauri::Wry>>>);
impl PinMenus {
    pub fn clear_window(&self, window: &str) {
        if let Ok(mut slots) = self.0.lock()
            && let Some(pending) = slots.0.remove(window)
        {
            let _ = pending.sender.send(Ok(None));
        }
    }
    pub fn clear(&self) {
        if let Ok(mut slots) = self.0.lock() {
            for (_, pending) in slots.0.drain() {
                let _ = pending.sender.send(Ok(None));
            }
        }
    }
    fn finish(&self, window: &str, request: &str, token: Option<&str>, reply: Reply) {
        let pending = self
            .0
            .lock()
            .ok()
            .and_then(|mut s| s.take(window, request, token));
        if let Some(pending) = pending {
            let _ = pending.sender.send(reply);
        }
    }
}
fn valid_request(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn valid_window(label: &str) -> bool {
    label == "main"
        || matches!(
            label.strip_prefix("iceon-"),
            Some("1" | "2" | "3" | "4" | "5" | "6" | "7")
        )
}
fn item_id(window: &str, request: &str, token: &str, index: usize) -> String {
    format!("pin-menu:{window}:{request}:{token}:{index}")
}
pub fn install(app: &tauri::App) {
    app.manage(Arc::new(PinMenus::default()));
    app.on_menu_event(|app, event| {
        let menus = app.state::<Arc<PinMenus>>();
        let selection = menus.0.lock().ok().and_then(|slots| {
            slots.0.iter().find_map(|(window, p)| {
                [
                    PinMenuAction::Unpin,
                    PinMenuAction::MoveUp,
                    PinMenuAction::MoveDown,
                ]
                .into_iter()
                .enumerate()
                .find_map(|(i, action)| {
                    (item_id(window, &p.request_id, &p.token, i) == event.id().as_ref()).then(
                        || {
                            (
                                window.clone(),
                                p.request_id.clone(),
                                p.token.clone(),
                                action,
                            )
                        },
                    )
                })
            })
        });
        if let Some((window, request, token, action)) = selection {
            menus.finish(&window, &request, Some(&token), Ok(Some(action)));
        }
    });
}
struct Lease {
    menus: Arc<PinMenus>,
    window: String,
    request: String,
    token: String,
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.menus
            .finish(&self.window, &self.request, Some(&self.token), Ok(None));
    }
}
async fn pinned(app: &tauri::AppHandle, target: PinTarget) -> Result<(), CatalogError> {
    let engine = app.state::<Arc<CatalogEngine>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.validate_pin_target(&target))
        .await
        .map_err(|_| CatalogError::StoreUnavailable)?
}
#[tauri::command]
pub async fn catalog_pin_menu_show(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: ShowRequest,
) -> Reply {
    if !valid_window(window.label()) || !valid_request(&request.request_id) {
        return Err(CatalogError::InvalidInput);
    }
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| CatalogError::OpenFailed)?;
    let token: String = random.iter().map(|b| format!("{b:02x}")).collect();
    let menus = app.state::<Arc<PinMenus>>().inner().clone();
    let lease = Lease {
        menus: menus.clone(),
        window: window.label().to_owned(),
        request: request.request_id.clone(),
        token: token.clone(),
    };
    let (sender, receiver) = oneshot::channel();
    menus
        .0
        .lock()
        .map_err(|_| CatalogError::StoreUnavailable)?
        .replace(
            lease.window.clone(),
            Pending {
                request_id: request.request_id.clone(),
                token: token.clone(),
                sender,
                menu: None,
            },
        );
    let operation = async {
        pinned(&app, request.target.clone()).await?;
        let popup_app = app.clone();
        let popup_window = lease.window.clone();
        let popup_request = request.request_id.clone();
        // Native popup may enter a platform menu loop; never block the async executor.
        app.run_on_main_thread(move || {
            let result = (|| {
                let menu = Menu::new(&popup_app).map_err(|_| CatalogError::OpenFailed)?;
                for (i, action) in [
                    PinMenuAction::Unpin,
                    PinMenuAction::MoveUp,
                    PinMenuAction::MoveDown,
                ]
                .into_iter()
                .enumerate()
                {
                    let item = MenuItem::with_id(
                        &popup_app,
                        item_id(&popup_window, &popup_request, &token, i),
                        action.label(),
                        true,
                        None::<&str>,
                    )
                    .map_err(|_| CatalogError::OpenFailed)?;
                    menu.append(&item).map_err(|_| CatalogError::OpenFailed)?;
                }
                {
                    let mut slots = menus.0.lock().map_err(|_| CatalogError::StoreUnavailable)?;
                    let Some(pending) = slots
                        .0
                        .get_mut(&popup_window)
                        .filter(|p| p.request_id == popup_request && p.token == token)
                    else {
                        return Ok(());
                    };
                    pending.menu = Some(menu.clone());
                }
                window
                    .popup_menu(&menu)
                    .map_err(|_| CatalogError::OpenFailed)
            })();
            if let Err(error) = result {
                menus.finish(&popup_window, &popup_request, Some(&token), Err(error));
            }
        })
        .map_err(|_| CatalogError::OpenFailed)?;
        let selected = receiver.await.unwrap_or(Ok(None))?;
        if selected.is_some() {
            pinned(&app, request.target).await?;
        }
        Ok(selected)
    };
    // Tauri has no portable dismissal callback; cancellation or expiry resolves None.
    tokio::time::timeout(LIFETIME, operation)
        .await
        .unwrap_or(Ok(None))
}
#[tauri::command]
pub fn catalog_pin_menu_cancel(
    window: tauri::WebviewWindow,
    menus: tauri::State<'_, Arc<PinMenus>>,
    request: CancelRequest,
) -> Result<(), CatalogError> {
    if !valid_window(window.label()) || !valid_request(&request.request_id) {
        return Err(CatalogError::InvalidInput);
    }
    menus.finish(window.label(), &request.request_id, None, Ok(None));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_and_window_validation_are_bounded() {
        assert!(valid_request("01234567-89ab-CDEF-0123-456789abcdef"));
        for invalid in [
            "",
            "------------------------------------",
            "0123456789ab-cdef-0123-456789abcdef",
            "01234567-89ab-cdef-0123-456789abcdeg",
        ] {
            assert!(!valid_request(invalid));
        }
        for window in ["main", "iceon-1", "iceon-7"] {
            assert!(valid_window(window));
        }
        for window in ["", "iceon-0", "iceon-8", "iceon-01", "other"] {
            assert!(!valid_window(window));
        }
        assert!(
            serde_json::from_value::<CancelRequest>(
                serde_json::json!({"requestId":"x","window":"main"})
            )
            .is_err()
        );
        assert_eq!(
            serde_json::to_string(&PinMenuAction::MoveUp).unwrap(),
            "\"moveUp\""
        );
    }
    fn pending(request: &str, token: &str) -> (Pending<()>, oneshot::Receiver<Reply>) {
        let (sender, receiver) = oneshot::channel();
        (
            Pending {
                request_id: request.into(),
                token: token.into(),
                sender,
                menu: None,
            },
            receiver,
        )
    }
    #[test]
    fn replacement_cancellation_and_selection_preserve_ownership() {
        let mut slots = Slots::<()>::default();
        let (first, mut first_reply) = pending("request", "old");
        slots.replace("main".into(), first);
        let (other, _other_reply) = pending("request", "other");
        slots.replace("iceon-1".into(), other);
        let (replacement, _reply) = pending("request", "new");
        slots.replace("main".into(), replacement);
        assert_eq!(first_reply.try_recv().unwrap(), Ok(None));
        assert!(slots.take("main", "request", Some("old")).is_none());
        assert!(slots.take("main", "stale", None).is_none());
        assert!(slots.take("iceon-2", "request", None).is_none());
        assert!(slots.take("main", "request", Some("new")).is_some());
        assert!(slots.take("main", "request", Some("new")).is_none());
        assert!(slots.take("iceon-1", "request", None).is_some());
    }

    #[test]
    fn destruction_and_shutdown_resolve_pending_requests() {
        let menus = PinMenus::default();
        let (sender, mut first) = oneshot::channel();
        let (other_sender, mut other) = oneshot::channel();
        {
            let mut slots = menus.0.lock().unwrap();
            for (window, sender) in [("main", sender), ("iceon-1", other_sender)] {
                slots.replace(
                    window.into(),
                    Pending {
                        request_id: "request".into(),
                        token: "token".into(),
                        sender,
                        menu: None,
                    },
                );
            }
        }
        menus.clear_window("main");
        assert_eq!(first.try_recv().unwrap(), Ok(None));
        assert!(matches!(
            other.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));
        menus.clear();
        assert_eq!(other.try_recv().unwrap(), Ok(None));
        assert!(menus.0.lock().unwrap().0.is_empty());
    }
}
