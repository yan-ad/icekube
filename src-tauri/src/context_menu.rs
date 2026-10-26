use crate::connection::{
    ConnectionEngine, ConnectionError, ResourceKind, SessionRequest, details::ResourceReference,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    Emitter, EventTarget, Manager,
    menu::{Menu, MenuItem},
};
use tokio_util::sync::CancellationToken;

const EVENT: &str = "icekube://row-context-menu";
const LIFETIME: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum RowAction {
    Details,
    Edit,
    Logs,
    Shell,
    Attach,
    Forward,
    Delete,
    Stop,
    Remove,
    Install,
}
impl RowAction {
    fn label(self) -> &'static str {
        match self {
            Self::Details => "Details",
            Self::Edit => "Edit YAML…",
            Self::Logs => "Logs",
            Self::Shell => "Shell…",
            Self::Attach => "Attach…",
            Self::Forward => "Forward port…",
            Self::Delete => "Delete…",
            Self::Stop => "Stop",
            Self::Remove => "Remove",
            Self::Install => "Install…",
        }
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Target {
    Resource { reference: ResourceReference },
    HelmChart { id: String, name: String },
    HelmRelease { name: String, namespace: String },
    Forward { id: String },
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShowRequest {
    cluster_id: String,
    session_id: String,
    request_id: String,
    target: Target,
    actions: Vec<RowAction>,
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    cluster_id: String,
    session_id: String,
    request_id: String,
}
impl ShowRequest {
    fn scope(&self) -> Scope {
        Scope {
            cluster_id: self.cluster_id.clone(),
            session_id: self.session_id.clone(),
            request_id: self.request_id.clone(),
        }
    }
}
impl Scope {
    fn session(&self) -> SessionRequest {
        SessionRequest {
            cluster_id: self.cluster_id.clone(),
            session_id: self.session_id.clone(),
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Selection {
    cluster_id: String,
    session_id: String,
    request_id: String,
    action: Option<RowAction>,
}
struct Active {
    scope: Scope,
    ids: Vec<(String, RowAction)>,
    cancel: CancellationToken,
    _menu: Menu<tauri::Wry>,
}
#[derive(Default)]
pub struct ContextMenus(Mutex<Option<Active>>);
impl ContextMenus {
    pub fn clear(&self) {
        if let Ok(mut slot) = self.0.lock()
            && let Some(active) = slot.take()
        {
            active.cancel.cancel();
        }
    }
    fn take(&self, scope: &Scope) -> Option<Active> {
        let mut slot = self.0.lock().ok()?;
        if slot.as_ref().is_some_and(|a| &a.scope == scope) {
            let active = slot.take()?;
            active.cancel.cancel();
            Some(active)
        } else {
            None
        }
    }
}
fn text(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.trim() == value
        && !value.chars().any(char::is_control)
}
fn label(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn namespaced(kind: ResourceKind) -> bool {
    use ResourceKind::*;
    matches!(
        kind,
        Pods | Deployments
            | DaemonSets
            | StatefulSets
            | ReplicaSets
            | ReplicationControllers
            | Jobs
            | CronJobs
            | ConfigMaps
            | Secrets
            | ResourceQuotas
            | LimitRanges
            | HorizontalPodAutoscalers
            | VerticalPodAutoscalers
            | PodDisruptionBudgets
            | Leases
            | Services
            | Endpoints
            | Ingresses
            | NetworkPolicies
            | EndpointSlices
            | PersistentVolumeClaims
            | Events
            | ServiceAccounts
            | Roles
            | RoleBindings
    )
}
fn validate(request: &ShowRequest) -> Result<(), ConnectionError> {
    let scope = request.scope();
    if !text(&scope.cluster_id, 256)
        || !text(&scope.session_id, 256)
        || scope.request_id.len() != 36
        || !scope
            .request_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
        || request.actions.is_empty()
        || request.actions.len() > 10
        || request.actions.iter().collect::<HashSet<_>>().len() != request.actions.len()
    {
        return Err(ConnectionError::InvalidInput);
    }
    let identity_valid = match &request.target {
        Target::Resource { reference: r } => {
            r.name.len() <= 253
                && r.name.split('.').all(|s| label(s, 63))
                && r.uid.as_deref().is_none_or(|uid| text(uid, 256))
                && if namespaced(r.kind) {
                    r.namespace.as_deref().is_some_and(|n| label(n, 63))
                } else {
                    r.namespace.is_none()
                }
        }
        Target::HelmChart { id, name } => text(id, 4096) && text(name, 253),
        Target::HelmRelease { name, namespace } => label(name, 53) && label(namespace, 63),
        Target::Forward { id } => text(id, 256),
    };
    if !identity_valid
        || request
            .actions
            .iter()
            .any(|a| !allowed(&request.target, *a))
    {
        return Err(ConnectionError::InvalidInput);
    }
    Ok(())
}
fn allowed(target: &Target, action: RowAction) -> bool {
    use RowAction::*;
    match target {
        Target::Resource { reference } => {
            matches!(action, Details | Delete)
                || reference.kind == ResourceKind::Pods
                    && matches!(action, Edit | Logs | Shell | Attach | Forward)
        }
        Target::HelmChart { .. } => matches!(action, Details | Install),
        Target::HelmRelease { .. } => action == Details,
        Target::Forward { .. } => matches!(action, Details | Stop | Remove),
    }
}
fn connected(app: &tauri::AppHandle, scope: &Scope) -> Result<(), ConnectionError> {
    let status = app
        .state::<Arc<ConnectionEngine>>()
        .status(scope.session())?;
    if status.status != "connected" {
        return Err(ConnectionError::NotConnected);
    }
    Ok(())
}
fn emit(app: &tauri::AppHandle, scope: Scope, action: Option<RowAction>) {
    let _ = app.emit_to(
        EventTarget::webview_window("main"),
        EVENT,
        Selection {
            cluster_id: scope.cluster_id,
            session_id: scope.session_id,
            request_id: scope.request_id,
            action,
        },
    );
}
pub fn install(app: &tauri::App) {
    app.manage(Arc::new(ContextMenus::default()));
    app.on_menu_event(|app, event| {
        let menus = app.state::<Arc<ContextMenus>>();
        let selection = menus.0.lock().ok().and_then(|slot| {
            let active = slot.as_ref()?;
            active
                .ids
                .iter()
                .find(|(id, _)| id == event.id().as_ref())
                .map(|(_, action)| (active.scope.clone(), *action))
        });
        if let Some((scope, action)) = selection
            && menus.take(&scope).is_some()
        {
            let selected = connected(app, &scope).ok().map(|()| action);
            emit(app, scope, selected);
        }
    });
}
#[tauri::command]
pub async fn row_context_menu_show(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: ShowRequest,
) -> Result<(), ConnectionError> {
    if window.label() != "main" {
        return Err(ConnectionError::InvalidInput);
    }
    validate(&request)?;
    let scope = request.scope();
    connected(&app, &scope)?;
    let menus = app.state::<Arc<ContextMenus>>().inner().clone();
    let menu = Menu::new(&app).map_err(|_| ConnectionError::ConnectionFailed)?;
    let mut ids = Vec::new();
    for (index, action) in request.actions.iter().enumerate() {
        let id = format!("row-context:{}:{index}", scope.request_id);
        let item = MenuItem::with_id(&app, &id, action.label(), true, None::<&str>)
            .map_err(|_| ConnectionError::ConnectionFailed)?;
        menu.append(&item)
            .map_err(|_| ConnectionError::ConnectionFailed)?;
        ids.push((id, *action));
    }
    let cancel = CancellationToken::new();
    {
        let mut slot = menus
            .0
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        if let Some(old) = slot.take() {
            old.cancel.cancel();
            emit(&app, old.scope, None);
        }
        *slot = Some(Active {
            scope: scope.clone(),
            ids,
            cancel: cancel.clone(),
            _menu: menu.clone(),
        });
    }
    let timer_app = app.clone();
    let timer_scope = scope.clone();
    let timer_menus = menus.clone();
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = cancel.cancelled() => {},
            _ = tokio::time::sleep(LIFETIME) => {
                if timer_menus.take(&timer_scope).is_some() { emit(&timer_app, timer_scope, None); }
            }
        }
    });
    if window.popup_menu(&menu).is_err() {
        menus.take(&scope);
        return Err(ConnectionError::ConnectionFailed);
    }
    // Tauri exposes no portable menu-dismiss event. Both owners expire the request after 30 seconds.
    Ok(())
}
#[tauri::command]
pub fn row_context_menu_cancel(
    window: tauri::WebviewWindow,
    menus: tauri::State<'_, Arc<ContextMenus>>,
    request: Scope,
) -> Result<(), ConnectionError> {
    if window.label() != "main" {
        return Err(ConnectionError::InvalidInput);
    }
    menus.take(&request);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pod() -> ShowRequest {
        serde_json::from_value(serde_json::json!({ "clusterId": "cluster", "sessionId": "session", "requestId": "00000000-0000-0000-0000-000000000001", "target": { "type": "resource", "reference": { "kind": "pods", "namespace": "default", "name": "pod", "uid": "uid" } }, "actions": ["details", "logs", "delete"] })).unwrap()
    }
    #[test]
    fn validates_resource_identity_and_action_categories() {
        let mut request = pod();
        assert!(validate(&request).is_ok());
        request.actions.push(RowAction::Install);
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
        request.actions = vec![RowAction::Details, RowAction::Details];
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
        request.actions = vec![RowAction::Logs];
        if let Target::Resource { reference } = &mut request.target {
            reference.kind = ResourceKind::Services;
        }
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
        request.actions = vec![RowAction::Details];
        if let Target::Resource { reference } = &mut request.target {
            reference.namespace = None;
        }
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
    }
    #[test]
    fn closed_dtos_reject_arbitrary_commands() {
        assert!(
            serde_json::from_value::<Target>(
                serde_json::json!({"type": "forward", "id": "x", "command": "delete"})
            )
            .is_err()
        );
        assert!(serde_json::from_str::<RowAction>("\"copyName\"").is_err());
        assert!(!allowed(
            &Target::HelmChart {
                id: "chart".into(),
                name: "chart".into()
            },
            RowAction::Delete
        ));
        assert!(!allowed(
            &Target::HelmRelease {
                name: "release".into(),
                namespace: "default".into()
            },
            RowAction::Remove
        ));
    }
    #[test]
    fn only_implemented_actions_are_allowed_for_each_target_family() {
        use RowAction::*;
        let all = [
            Details, Edit, Logs, Shell, Attach, Forward, Delete, Stop, Remove, Install,
        ];
        let resource = |kind| Target::Resource {
            reference: ResourceReference {
                kind,
                namespace: Some("default".into()),
                name: "alpha".into(),
                uid: Some("uid".into()),
            },
        };
        let cases = [
            (
                resource(ResourceKind::Pods),
                vec![Details, Edit, Logs, Shell, Attach, Forward, Delete],
            ),
            (resource(ResourceKind::Services), vec![Details, Delete]),
            (resource(ResourceKind::ConfigMaps), vec![Details, Delete]),
            (
                Target::HelmChart {
                    id: "cached-alpha".into(),
                    name: "stable/alpha".into(),
                },
                vec![Details, Install],
            ),
            (
                Target::HelmRelease {
                    name: "alpha".into(),
                    namespace: "default".into(),
                },
                vec![Details],
            ),
            (
                Target::Forward {
                    id: "forward-alpha".into(),
                },
                vec![Details, Stop, Remove],
            ),
        ];
        for (target, expected) in cases {
            for action in all {
                assert_eq!(
                    allowed(&target, action),
                    expected.contains(&action),
                    "{target:?}: {action:?}"
                );
            }
        }
    }
    #[test]
    fn validation_rejects_empty_and_duplicate_actions_and_invalid_scope() {
        let mut request = pod();
        request.actions.clear();
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
        request.actions = vec![RowAction::Details, RowAction::Details];
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
        request.actions = vec![RowAction::Details];
        request.session_id = " session ".into();
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
        request.session_id = "session".into();
        request.request_id = "invalid".into();
        assert_eq!(validate(&request), Err(ConnectionError::InvalidInput));
    }
    #[test]
    fn stale_cancel_does_not_match_another_scope() {
        let scope = pod().scope();
        let mut stale = scope.clone();
        stale.session_id = "other".into();
        assert_ne!(scope, stale);
        let menus = ContextMenus::default();
        assert!(menus.take(&stale).is_none());
        menus.clear();
    }
}
