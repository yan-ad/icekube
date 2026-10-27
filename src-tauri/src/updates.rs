//! Rust-only updater ownership. IPC exposes neither manifests nor downloaded bytes.
use futures::{StreamExt, future::BoxFuture};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use url::Url;

pub const ENDPOINT: &str = "https://github.com/yan-ad/iceon/releases/latest/download/latest.json";
const INTERVAL: Duration = Duration::from_secs(300);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(180);
const MANIFEST_LIMIT: usize = 256 * 1024;
const PACKAGE_LIMIT: usize = 256 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateError {
    #[allow(dead_code)]
    Unavailable,
    TrustNotConfigured,
    InvalidProxy,
    CheckFailed,
    DownloadFailed,
    LimitExceeded,
    TimedOut,
    InvalidRelease,
    VerificationFailed,
    InstallFailed,
    NotReady,
    Busy,
    Stopped,
}
#[tauri::command]
pub fn update_check(engine: tauri::State<'_, Arc<UpdateEngine>>) -> UpdateSnapshot {
    engine.request_check()
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Disabled,
    Idle,
    Checking,
    Downloading,
    Ready,
    Restarting,
    Error,
    Stopped,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub phase: Phase,
    pub version: Option<String>,
    pub error: Option<UpdateError>,
}
trait Package: Send {
    fn install(self: Box<Self>) -> Result<(), UpdateError>;
}
struct Staged {
    version: String,
    package: Box<dyn Package>,
}
trait Provider: Send + Sync {
    fn stage(&self, phase: Arc<Mutex<Inner>>)
    -> BoxFuture<'_, Result<Option<Staged>, UpdateError>>;
}
struct Inner {
    snapshot: UpdateSnapshot,
    staged: Option<Staged>,
}
pub struct UpdateEngine {
    inner: Arc<Mutex<Inner>>,
    cancel: CancellationToken,
    tasks: TaskTracker,
    check_requested: tokio::sync::Notify,
}

impl UpdateEngine {
    /// Call once from setup and manage the returned Arc. Debug and non-Apple-silicon builds stay offline.
    #[allow(dead_code)]
    pub fn start(app: AppHandle) -> Arc<Self> {
        Self::start_with_proxy(app, None)
    }
    pub fn request_check(&self) -> UpdateSnapshot {
        let snapshot = self.snapshot();
        if matches!(snapshot.phase, Phase::Idle | Phase::Error) && !self.cancel.is_cancelled() {
            self.check_requested.notify_one();
        }
        snapshot
    }
    pub fn start_with_proxy(app: AppHandle, proxy: Option<&str>) -> Arc<Self> {
        let proxy = proxy.map(validate_proxy).transpose();
        let key = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|v| v.get("pubkey"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_owned();
        let enabled = cfg!(all(
            target_os = "macos",
            target_arch = "aarch64",
            not(debug_assertions)
        ));
        let error = if !enabled {
            None
        } else if key.is_empty() {
            Some(UpdateError::TrustNotConfigured)
        } else {
            proxy.as_ref().err().cloned()
        };
        let engine = Self::new(
            if enabled && error.is_none() {
                Phase::Idle
            } else {
                Phase::Disabled
            },
            error,
        );
        if enabled && engine.snapshot().error.is_none() {
            let provider = Arc::new(OfficialProvider {
                app,
                key,
                proxy: proxy.unwrap_or(None),
            });
            engine.launch(provider, tauri::async_runtime::handle().inner());
        }
        engine
    }
    fn new(phase: Phase, error: Option<UpdateError>) -> Arc<Self> {
        Arc::new(Self {
            inner: Arc::new(Mutex::new(Inner {
                snapshot: UpdateSnapshot {
                    phase,
                    version: None,
                    error,
                },
                staged: None,
            })),
            cancel: CancellationToken::new(),
            tasks: TaskTracker::new(),
            check_requested: tokio::sync::Notify::new(),
        })
    }
    fn launch(self: &Arc<Self>, provider: Arc<dyn Provider>, runtime: &tokio::runtime::Handle) {
        let engine = self.clone();
        self.tasks
            .spawn_on(async move { engine.run(provider).await }, runtime);
    }
    async fn run(&self, provider: Arc<dyn Provider>) {
        let mut ticks = tokio::time::interval(INTERVAL);
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! { biased; _ = self.cancel.cancelled() => break, _ = ticks.tick() => {}, _ = self.check_requested.notified() => {} }
            {
                let mut state = self.inner.lock().unwrap();
                if matches!(state.snapshot.phase, Phase::Ready | Phase::Restarting) {
                    continue;
                }
                state.snapshot = UpdateSnapshot {
                    phase: Phase::Checking,
                    version: None,
                    error: None,
                };
            }
            let result = tokio::select! { biased; _ = self.cancel.cancelled() => break, result = tokio::time::timeout(CHECK_TIMEOUT + DOWNLOAD_TIMEOUT, provider.stage(self.inner.clone())) => result.unwrap_or(Err(UpdateError::TimedOut)) };
            let mut state = self.inner.lock().unwrap();
            if self.cancel.is_cancelled() {
                break;
            }
            match result {
                Ok(Some(staged)) => {
                    state.snapshot = UpdateSnapshot {
                        phase: Phase::Ready,
                        version: Some(staged.version.clone()),
                        error: None,
                    };
                    state.staged = Some(staged);
                }
                Ok(None) => state.snapshot.phase = Phase::Idle,
                Err(error) => {
                    state.snapshot.phase = Phase::Error;
                    state.snapshot.error = Some(error);
                }
            }
        }
    }
    pub fn snapshot(&self) -> UpdateSnapshot {
        self.inner.lock().unwrap().snapshot.clone()
    }
    pub fn shutdown(&self) {
        self.cancel.cancel();
        let mut state = self.inner.lock().unwrap();
        state.staged.take();
        if state.snapshot.phase != Phase::Restarting {
            state.snapshot.phase = Phase::Stopped;
            state.snapshot.version = None;
        }
        self.tasks.close();
    }
    pub async fn drain(&self) {
        self.tasks.wait().await;
    }
    fn take_ready(&self) -> Result<Staged, UpdateError> {
        let mut state = self.inner.lock().unwrap();
        if self.cancel.is_cancelled() {
            return Err(UpdateError::Stopped);
        }
        if state.snapshot.phase == Phase::Restarting {
            return Err(UpdateError::Busy);
        }
        let staged = state.staged.take().ok_or(UpdateError::NotReady)?;
        state.snapshot.phase = Phase::Restarting;
        Ok(staged)
    }
}

pub fn validate_proxy(input: &str) -> Result<Url, UpdateError> {
    if input.len() > 2048 {
        return Err(UpdateError::InvalidProxy);
    }
    let url = Url::parse(input).map_err(|_| UpdateError::InvalidProxy)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(UpdateError::InvalidProxy);
    }
    Ok(url)
}
fn asset_allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && {
            let parts: Vec<_> = url.path().split('/').collect();
            parts.len() == 7
                && parts[1..5] == ["yan-ad", "iceon", "releases", "download"]
                && !parts[5].is_empty()
                && parts[6].ends_with(".app.tar.gz")
                && !url.path().contains('%')
        }
}
fn client(proxy: Option<&Url>) -> Result<reqwest::Client, UpdateError> {
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let host = url.host_str().unwrap_or("");
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && (host == "github.com"
                    || host == "release-assets.githubusercontent.com"
                    || host == "objects.githubusercontent.com")
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }));
    if let Some(proxy) = proxy {
        builder = builder
            .proxy(reqwest::Proxy::all(proxy.as_str()).map_err(|_| UpdateError::InvalidProxy)?);
    }
    builder.build().map_err(|_| UpdateError::CheckFailed)
}
async fn fetch(client: &reqwest::Client, url: Url, limit: usize) -> Result<Vec<u8>, UpdateError> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| UpdateError::DownloadFailed)?;
    if !response.status().is_success() {
        return Err(UpdateError::DownloadFailed);
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(UpdateError::LimitExceeded);
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| UpdateError::DownloadFailed)?;
        append_bounded(&mut bytes, &chunk, limit)?;
    }
    Ok(bytes)
}
fn append_bounded(bytes: &mut Vec<u8>, chunk: &[u8], limit: usize) -> Result<(), UpdateError> {
    if chunk.len() > limit.saturating_sub(bytes.len()) {
        return Err(UpdateError::LimitExceeded);
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}
struct OfficialProvider {
    app: AppHandle,
    key: String,
    proxy: Option<Url>,
}
struct OfficialPackage {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}
impl Package for OfficialPackage {
    fn install(self: Box<Self>) -> Result<(), UpdateError> {
        self.update
            .install(&self.bytes)
            .map_err(|_| UpdateError::InstallFailed)
    }
}
impl Provider for OfficialProvider {
    fn stage(
        &self,
        phase: Arc<Mutex<Inner>>,
    ) -> BoxFuture<'_, Result<Option<Staged>, UpdateError>> {
        Box::pin(async move {
            let client = client(self.proxy.as_ref())?;
            // The plugin check/download APIs buffer without a byte ceiling. Bound transport here,
            // then use its official restore/verify/install path with the same pinned trust key.
            let metadata = tokio::time::timeout(
                CHECK_TIMEOUT,
                fetch(&client, Url::parse(ENDPOINT).unwrap(), MANIFEST_LIMIT),
            )
            .await
            .map_err(|_| UpdateError::TimedOut)??;
            let json =
                serde_json::from_slice(&metadata).map_err(|_| UpdateError::InvalidRelease)?;
            let updater = self
                .app
                .updater_builder()
                .pubkey(&self.key)
                .target("darwin-aarch64")
                .build()
                .map_err(|_| UpdateError::CheckFailed)?;
            let Some(update) = updater
                .restore_update(json)
                .map_err(|_| UpdateError::InvalidRelease)?
            else {
                return Ok(None);
            };
            if !asset_allowed(&update.download_url) || update.version.len() > 100 {
                return Err(UpdateError::InvalidRelease);
            }
            phase.lock().unwrap().snapshot.phase = Phase::Downloading;
            let bytes = tokio::time::timeout(
                DOWNLOAD_TIMEOUT,
                fetch(&client, update.download_url.clone(), PACKAGE_LIMIT),
            )
            .await
            .map_err(|_| UpdateError::TimedOut)??;
            update
                .verify(&bytes)
                .map_err(|_| UpdateError::VerificationFailed)?;
            Ok(Some(Staged {
                version: update.version.clone(),
                package: Box::new(OfficialPackage { update, bytes }),
            }))
        })
    }
}
#[tauri::command]
pub fn update_state(engine: tauri::State<'_, Arc<UpdateEngine>>) -> UpdateSnapshot {
    engine.snapshot()
}
#[tauri::command]
pub async fn update_restart(
    app: AppHandle,
    engine: tauri::State<'_, Arc<UpdateEngine>>,
) -> Result<(), UpdateError> {
    let staged = engine.take_ready()?;
    let owner = engine.inner().clone();
    let tasks = owner.tasks.clone();
    tasks
        .spawn_on(
            async move {
                let result = tauri::async_runtime::spawn_blocking(move || staged.package.install())
                    .await
                    .map_err(|_| UpdateError::InstallFailed)
                    .and_then(|result| result);
                if let Err(error) = result {
                    let mut state = owner.inner.lock().unwrap();
                    state.snapshot = UpdateSnapshot {
                        phase: Phase::Error,
                        version: None,
                        error: Some(error.clone()),
                    };
                    return Err(error);
                }
                owner.cancel.cancel();
                let connections = app.state::<Arc<crate::connection::ConnectionEngine>>();
                connections.shutdown();
                connections.drain().await;
                app.restart();
            },
            tauri::async_runtime::handle().inner(),
        )
        .await
        .map_err(|_| UpdateError::InstallFailed)?
}
#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;
