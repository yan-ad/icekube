use crate::catalog::{CatalogEngine, CatalogError, ConnectionTarget};
use kube::Client;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

mod auth;
mod config;
#[cfg(test)]
mod lifecycle_tests;
mod metrics;
#[cfg(test)]
mod resource_tests;
mod resources;
#[cfg(test)]
mod tests;
mod transport;

const DEADLINE: Duration = Duration::from_secs(15);
type Result<T> = std::result::Result<T, ConnectionError>;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionError {
    InvalidInput,
    NotFound,
    KubeconfigUnavailable,
    KubeconfigInvalid,
    SourceChanged,
    UnsupportedAuth,
    AuthHelperMissing,
    AuthHelperFailed,
    AuthHelperInvalidResponse,
    AuthInteractiveRequired,
    AuthExpired,
    InsecureTransport,
    AuthFailed,
    TlsFailed,
    PermissionDenied,
    ResourceUnavailable,
    Timeout,
    Network,
    ConnectionFailed,
    NotConnected,
    StaleSession,
    Busy,
    LimitExceeded,
    InvalidResponse,
    StoreUnavailable,
}
fn validate_credentials(client: &Client) -> Result<()> {
    if client
        .valid_until()
        .is_some_and(|expiry| expiry <= jiff::Timestamp::now())
    {
        Err(ConnectionError::AuthExpired)
    } else {
        Ok(())
    }
}
fn validate_read_id(id: u64) -> Result<()> {
    if id == 0 || id > 9_007_199_254_740_991 {
        Err(ConnectionError::InvalidInput)
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenRequest {
    pub cluster_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    pub cluster_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    Nodes,
    Namespaces,
    Pods,
    Deployments,
    DaemonSets,
    StatefulSets,
    ReplicaSets,
    Jobs,
    CronJobs,
    ConfigMaps,
    Secrets,
    ResourceQuotas,
    LimitRanges,
    HorizontalPodAutoscalers,
    PodDisruptionBudgets,
    PriorityClasses,
    RuntimeClasses,
    Services,
    Endpoints,
    Ingresses,
    IngressClasses,
    NetworkPolicies,
    PersistentVolumes,
    PersistentVolumeClaims,
    StorageClasses,
    Events,
    ServiceAccounts,
    Roles,
    RoleBindings,
    ClusterRoles,
    ClusterRoleBindings,
    CustomResourceDefinitions,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResourceRequest {
    pub cluster_id: String,
    pub session_id: String,
    pub kind: ResourceKind,
    pub read_id: u64,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub continue_token: Option<String>,
}
impl ResourceRequest {
    fn session(&self) -> SessionRequest {
        SessionRequest {
            cluster_id: self.cluster_id.clone(),
            session_id: self.session_id.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSnapshot {
    pub cluster_id: String,
    pub session_id: String,
    pub context_name: String,
    pub status: &'static str,
    pub api_version: Option<String>,
    pub error: Option<ConnectionError>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePage {
    pub cluster_id: String,
    pub session_id: String,
    pub kind: ResourceKind,
    pub read_id: u64,
    pub items: Vec<ResourceItem>,
    pub truncated: bool,
    pub fetched_at: u64,
    pub namespace: Option<String>,
    pub continue_token: Option<String>,
    pub metrics: Option<MetricState>,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceItem {
    pub name: String,
    pub status: String,
    pub namespace: Option<String>,
    pub created_at: Option<String>,
    pub columns: std::collections::BTreeMap<String, String>,
    pub node: Option<NodeInfo>,
}
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetricState {
    Available,
    Unavailable,
    Denied,
    Stale,
    Partial,
    Error,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub roles: Vec<String>,
    pub version: Option<String>,
    pub cpu: Usage,
    pub memory: Usage,
    pub metrics_timestamp: Option<String>,
}
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Usage {
    pub used: Option<f64>,
    pub allocatable: Option<f64>,
    pub capacity: Option<f64>,
}

struct Session {
    target: ConnectionTarget,
    snapshot: ConnectionSnapshot,
    client: Option<Client>,
    cancel: CancellationToken,
    reads: HashMap<ResourceKind, ReadSlot>,
}
struct ReadSlot {
    id: u64,
    cancel: Option<CancellationToken>,
}
impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

// A single main-window workspace owns the lease. Replacing or dropping it cancels all work.
pub struct ConnectionEngine {
    catalog: Arc<CatalogEngine>,
    session: Mutex<Option<Session>>,
    workers: tokio::sync::Semaphore,
    file_workers: Arc<tokio::sync::Semaphore>,
    auth_tasks: tokio_util::task::TaskTracker,
    open_generation: AtomicU64,
}
impl ConnectionEngine {
    pub fn new(catalog: Arc<CatalogEngine>) -> Self {
        Self {
            catalog,
            session: Mutex::new(None),
            workers: tokio::sync::Semaphore::new(4),
            file_workers: Arc::new(tokio::sync::Semaphore::new(2)),
            auth_tasks: tokio_util::task::TaskTracker::new(),
            open_generation: AtomicU64::new(0),
        }
    }
    pub async fn open(&self, request: OpenRequest) -> Result<ConnectionSnapshot> {
        validate_id(&request.cluster_id)?;
        let generation = {
            let mut state = self
                .session
                .lock()
                .map_err(|_| ConnectionError::StoreUnavailable)?;
            let generation = self.open_generation.fetch_add(1, Ordering::SeqCst) + 1;
            state.take();
            generation
        };
        let catalog = self.catalog.clone();
        let id = request.cluster_id.clone();
        let target = tauri::async_runtime::spawn_blocking(move || catalog.connection_target(&id))
            .await
            .map_err(|_| ConnectionError::StoreUnavailable)?
            .map_err(map_catalog_error)?;
        let mut random = [0; 16];
        getrandom::fill(&mut random).map_err(|_| ConnectionError::ConnectionFailed)?;
        let snapshot = ConnectionSnapshot {
            cluster_id: request.cluster_id,
            session_id: random.iter().map(|byte| format!("{byte:02x}")).collect(),
            context_name: target.context_name.clone(),
            status: "disconnected",
            api_version: None,
            error: None,
        };
        let mut state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        if generation != self.open_generation.load(Ordering::SeqCst) {
            return Err(ConnectionError::StaleSession);
        }
        *state = Some(Session {
            target,
            snapshot: snapshot.clone(),
            client: None,
            cancel: CancellationToken::new(),
            reads: HashMap::new(),
        });
        Ok(snapshot)
    }
    pub fn disconnect(&self, request: SessionRequest) -> Result<()> {
        validate_request(&request)?;
        let mut state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        // Old disposal cannot release a replacement lease, including one for the same cluster.
        if state.as_ref().is_some_and(|s| matches_session(s, &request)) {
            state.take();
        }
        Ok(())
    }
    pub fn shutdown(&self) {
        self.open_generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut state) = self.session.lock() {
            state.take();
        }
    }
    pub async fn drain(&self) {
        // Cancellation must reach connect futures before their helper trackers can be empty.
        let _workers = self.workers.acquire_many(4).await;
        self.auth_tasks.close();
        self.auth_tasks.wait().await;
    }
    pub fn status(&self, request: SessionRequest) -> Result<ConnectionSnapshot> {
        validate_request(&request)?;
        let state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        Ok(current(&state, &request)?.snapshot.clone())
    }
    pub async fn connect(&self, request: SessionRequest) -> Result<ConnectionSnapshot> {
        self.connect_with(request, |target| {
            config::build_client(target, self.file_workers.clone(), self.auth_tasks.clone())
        })
        .await
    }
    async fn connect_with<F, Fut>(
        &self,
        request: SessionRequest,
        build: F,
    ) -> Result<ConnectionSnapshot>
    where
        F: FnOnce(ConnectionTarget) -> Fut,
        Fut: Future<Output = Result<Client>>,
    {
        validate_request(&request)?;
        let _permit = self
            .workers
            .try_acquire()
            .map_err(|_| ConnectionError::Busy)?;
        let (target, cancel) = {
            let mut state = self
                .session
                .lock()
                .map_err(|_| ConnectionError::StoreUnavailable)?;
            let session = current_mut(&mut state, &request)?;
            match session.snapshot.status {
                "connecting" => return Err(ConnectionError::Busy),
                "connected" => return Ok(session.snapshot.clone()),
                _ => {}
            }
            session.snapshot.status = "connecting";
            session.snapshot.error = None;
            (session.target.clone(), session.cancel.child_token())
        };
        let result = bounded(&cancel, async {
            let client = build(target.clone()).await?;
            // Saved metadata may have been removed/reimported during configuration preparation.
            let catalog = self.catalog.clone();
            let id = request.cluster_id.clone();
            let latest =
                tauri::async_runtime::spawn_blocking(move || catalog.connection_target(&id))
                    .await
                    .map_err(|_| ConnectionError::StoreUnavailable)?
                    .map_err(map_catalog_error)?;
            if latest != target {
                return Err(ConnectionError::SourceChanged);
            }
            let version = transport::version(&client, &cancel).await?;
            validate_credentials(&client)?;
            Ok((client, version))
        })
        .await;
        let mut state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        let session = current_mut(&mut state, &request)?;
        match result {
            Ok((client, version)) => {
                session.client = Some(client);
                session.snapshot.status = "connected";
                session.snapshot.api_version = Some(version);
                session.snapshot.error = None;
            }
            Err(error) => {
                session.client = None;
                session.snapshot.status = "error";
                session.snapshot.api_version = None;
                session.snapshot.error = Some(error);
            }
        }
        Ok(session.snapshot.clone())
    }
    pub fn cancel_resources(&self, request: ResourceRequest) -> Result<()> {
        transport::validate_resource_request(&request)?;
        validate_request(&request.session())?;
        validate_read_id(request.read_id)?;
        let mut state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        if let Some(session) = state
            .as_mut()
            .filter(|s| matches_session(s, &request.session()))
        {
            let slot = session.reads.entry(request.kind).or_insert(ReadSlot {
                id: 0,
                cancel: None,
            });
            if request.read_id >= slot.id {
                if let Some(cancel) = slot.cancel.take() {
                    cancel.cancel();
                }
                slot.id = request.read_id;
            }
        }
        Ok(())
    }
    pub async fn resources(&self, request: ResourceRequest) -> Result<ResourcePage> {
        transport::validate_resource_request(&request)?;
        let identity = request.session();
        validate_request(&identity)?;
        validate_read_id(request.read_id)?;
        let _permit = self
            .workers
            .try_acquire()
            .map_err(|_| ConnectionError::Busy)?;
        let (client, cancel) = {
            let mut state = self
                .session
                .lock()
                .map_err(|_| ConnectionError::StoreUnavailable)?;
            let session = current_mut(&mut state, &identity)?;
            let client = session
                .client
                .clone()
                .ok_or(ConnectionError::NotConnected)?;
            validate_credentials(&client)?;
            let cancel = session.cancel.child_token();
            let slot = session.reads.entry(request.kind).or_insert(ReadSlot {
                id: 0,
                cancel: None,
            });
            if request.read_id <= slot.id {
                return Err(ConnectionError::StaleSession);
            }
            if let Some(old) = slot.cancel.replace(cancel.clone()) {
                old.cancel();
            }
            slot.id = request.read_id;
            (client, cancel)
        };
        let result = bounded(&cancel, transport::resources(&client, &request, &cancel)).await;
        let mut state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        let session = current_mut(&mut state, &identity)?;
        let slot = session
            .reads
            .get_mut(&request.kind)
            .ok_or(ConnectionError::StaleSession)?;
        if slot.id != request.read_id {
            return Err(ConnectionError::StaleSession);
        }
        if cancel.is_cancelled() && result != Err(ConnectionError::Timeout) {
            return Err(ConnectionError::StaleSession);
        }
        slot.cancel = None;
        result
    }
}
async fn bounded<T>(
    cancel: &CancellationToken,
    operation: impl Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ConnectionError::StaleSession),
        result = tokio::time::timeout(DEADLINE, operation) => match result {
            Ok(result) => result,
            Err(_) => { cancel.cancel(); Err(ConnectionError::Timeout) }
        },
    }
}
fn matches_session(session: &Session, request: &SessionRequest) -> bool {
    session.snapshot.cluster_id == request.cluster_id
        && session.snapshot.session_id == request.session_id
}
fn current<'a>(state: &'a Option<Session>, request: &SessionRequest) -> Result<&'a Session> {
    state
        .as_ref()
        .filter(|s| matches_session(s, request))
        .ok_or(ConnectionError::StaleSession)
}
fn current_mut<'a>(
    state: &'a mut Option<Session>,
    request: &SessionRequest,
) -> Result<&'a mut Session> {
    state
        .as_mut()
        .filter(|s| matches_session(s, request))
        .ok_or(ConnectionError::StaleSession)
}
fn validate_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 256 || id.trim() != id || id.chars().any(char::is_control) {
        Err(ConnectionError::InvalidInput)
    } else {
        Ok(())
    }
}
fn validate_request(request: &SessionRequest) -> Result<()> {
    validate_id(&request.cluster_id)?;
    validate_id(&request.session_id)
}
fn map_catalog_error(error: CatalogError) -> ConnectionError {
    match error {
        CatalogError::InvalidInput => ConnectionError::InvalidInput,
        CatalogError::NotFound => ConnectionError::NotFound,
        CatalogError::StoreUnavailable | CatalogError::StoreCorrupt => {
            ConnectionError::StoreUnavailable
        }
        CatalogError::LimitExceeded => ConnectionError::LimitExceeded,
        _ => ConnectionError::KubeconfigUnavailable,
    }
}
