//! Rust-only updater ownership. IPC exposes neither manifests nor downloaded bytes.
use futures::{StreamExt, future::BoxFuture};
use serde::Serialize;
use std::{
    collections::HashMap,
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
const READY_LEASE: Duration = Duration::from_secs(5);
const PREPARATION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    MacArm,
    WindowsX86,
}
impl Target {
    fn for_platform(os: &str, arch: &str) -> Option<Self> {
        match (os, arch) {
            ("macos", "aarch64") => Some(Self::MacArm),
            ("windows", "x86") => Some(Self::WindowsX86),
            _ => None,
        }
    }
    fn key(self) -> &'static str {
        match self {
            Self::MacArm => "darwin-aarch64",
            Self::WindowsX86 => "windows-i686",
        }
    }
    fn asset(self, version: &str) -> String {
        match self {
            Self::MacArm => format!("Iceon_{version}_aarch64.app.tar.gz"),
            Self::WindowsX86 => format!("Iceon_{version}_x86-setup.exe"),
        }
    }
}

#[derive(Default)]
pub struct WindowGate(Mutex<WindowLifecycle>);
#[derive(Default)]
struct WindowLifecycle {
    windows: HashMap<String, AdmittedWindow>,
    preparation: Option<(String, tokio::time::Instant)>,
    restarting: bool,
    retry_after: Option<tokio::time::Instant>,
}
struct AdmittedWindow {
    generation: u64,
    identity: Option<usize>,
    ready: Option<tokio::time::Instant>,
    prepared: Option<tokio::time::Instant>,
}
impl WindowGate {
    pub fn admit(&self, label: &str) -> std::io::Result<u64> {
        let mut gate = self.0.lock().unwrap();
        if gate.preparation.is_some() || gate.restarting || gate.windows.contains_key(label) {
            return Err(std::io::Error::other(
                "Window admission is closed for update preparation.",
            ));
        }
        let mut bytes = [0; 8];
        getrandom::fill(&mut bytes).map_err(std::io::Error::other)?;
        let generation = u64::from_ne_bytes(bytes);
        gate.windows.insert(
            label.to_owned(),
            AdmittedWindow {
                generation,
                identity: None,
                ready: None,
                prepared: None,
            },
        );
        Ok(generation)
    }
    pub fn complete(&self, label: &str, generation: u64, identity: Option<usize>) {
        let mut gate = self.0.lock().unwrap();
        if let Some(entry) = gate
            .windows
            .get_mut(label)
            .filter(|w| w.generation == generation)
        {
            entry.identity = identity;
        }
    }
    pub fn forget(&self, label: &str, generation: u64) {
        let mut gate = self.0.lock().unwrap();
        if gate
            .windows
            .get(label)
            .is_some_and(|w| w.generation == generation)
        {
            gate.windows.remove(label);
        }
    }
}
pub fn window_identity(window: &tauri::WebviewWindow) -> Option<usize> {
    #[cfg(target_os = "macos")]
    {
        window.ns_window().ok().map(|pointer| pointer as usize)
    }
    #[cfg(target_os = "windows")]
    {
        window.hwnd().ok().map(|handle| handle.0 as usize)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = window;
        None
    }
}
impl WindowLifecycle {
    fn all_ready(&self) -> bool {
        self.windows
            .values()
            .all(|w| w.identity.is_some() && w.ready.is_some_and(|at| at.elapsed() < READY_LEASE))
    }
    fn all_prepared(&self) -> bool {
        self.windows.values().all(|w| {
            w.identity.is_some() && w.prepared.is_some_and(|at| at.elapsed() < READY_LEASE)
        })
    }
    fn thaw(&mut self) {
        self.preparation = None;
        self.restarting = false;
        self.retry_after = Some(tokio::time::Instant::now() + READY_LEASE);
        for entry in self.windows.values_mut() {
            entry.ready = None;
            entry.prepared = None;
        }
    }
}

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
    Preparing,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preparation_id: Option<String>,
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
    gate: Arc<WindowGate>,
}

impl UpdateEngine {
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
        let target = Target::for_platform(std::env::consts::OS, std::env::consts::ARCH);
        let enabled = target.is_some() && !cfg!(debug_assertions);
        let error = if !enabled {
            None
        } else if key.is_empty() {
            Some(UpdateError::TrustNotConfigured)
        } else {
            proxy.as_ref().err().cloned()
        };
        let engine = Self::with_gate(
            if enabled && error.is_none() {
                Phase::Idle
            } else {
                Phase::Disabled
            },
            error,
            app.state::<Arc<WindowGate>>().inner().clone(),
        );
        if enabled && engine.snapshot().error.is_none() {
            let provider = Arc::new(OfficialProvider {
                app: app.clone(),
                key,
                proxy: proxy.unwrap_or(None),
                target: target.unwrap(),
            });
            engine.launch(provider, tauri::async_runtime::handle().inner());
            let owner = engine.clone();
            engine.tasks.spawn_on(
                async move {
                    owner
                        .run_preparations(|| async {
                            let _ = owner.install_ready(&app).await;
                        })
                        .await;
                },
                tauri::async_runtime::handle().inner(),
            );
        }
        engine
    }
    #[cfg(test)]
    fn new(phase: Phase, error: Option<UpdateError>) -> Arc<Self> {
        Self::with_gate(phase, error, Arc::new(WindowGate::default()))
    }
    fn with_gate(phase: Phase, error: Option<UpdateError>, gate: Arc<WindowGate>) -> Arc<Self> {
        Arc::new(Self {
            inner: Arc::new(Mutex::new(Inner {
                snapshot: UpdateSnapshot {
                    phase,
                    version: None,
                    error,
                    preparation_id: None,
                },
                staged: None,
            })),
            cancel: CancellationToken::new(),
            tasks: TaskTracker::new(),
            check_requested: tokio::sync::Notify::new(),
            gate,
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
                if matches!(
                    state.snapshot.phase,
                    Phase::Ready | Phase::Preparing | Phase::Restarting
                ) {
                    continue;
                }
                state.snapshot = UpdateSnapshot {
                    phase: Phase::Checking,
                    version: None,
                    error: None,
                    preparation_id: None,
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
                        preparation_id: None,
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
    async fn run_preparations<F, Fut>(&self, mut install: F)
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut ticks = tokio::time::interval(Duration::from_secs(1));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! { biased; _ = self.cancel.cancelled() => break, _ = ticks.tick() => {} }
            // Only update_restart may authorize preparation; readiness is not consent.
            if self.snapshot().phase == Phase::Preparing {
                install().await;
            }
        }
    }
    pub fn shutdown(&self) {
        self.cancel.cancel();
        let mut gate = self.gate.0.lock().unwrap();
        let mut state = self.inner.lock().unwrap();
        state.staged.take();
        if state.snapshot.phase != Phase::Restarting {
            state.snapshot.phase = Phase::Stopped;
            state.snapshot.version = None;
            state.snapshot.preparation_id = None;
            gate.thaw();
        }
        self.tasks.close();
    }
    pub async fn drain(&self) {
        self.tasks.wait().await;
    }
    fn begin_preparation(&self) -> Result<(), UpdateError> {
        let mut gate = self.gate.0.lock().unwrap();
        let mut state = self.inner.lock().unwrap();
        if self.cancel.is_cancelled() {
            return Err(UpdateError::Stopped);
        }
        if state.snapshot.phase == Phase::Preparing {
            return Ok(());
        }
        if state.snapshot.phase == Phase::Restarting {
            return Err(UpdateError::Busy);
        }
        if state.snapshot.phase != Phase::Ready || state.staged.is_none() {
            return Err(UpdateError::NotReady);
        }
        if !gate.all_ready()
            || gate
                .retry_after
                .is_some_and(|at| at > tokio::time::Instant::now())
        {
            return Err(UpdateError::Busy);
        }
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(|_| UpdateError::Unavailable)?;
        let attempt = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
        gate.preparation = Some((attempt.clone(), tokio::time::Instant::now()));
        for entry in gate.windows.values_mut() {
            entry.prepared = None;
        }
        state.snapshot.phase = Phase::Preparing;
        state.snapshot.preparation_id = Some(attempt);
        Ok(())
    }
    fn abort_preparation(gate: &mut WindowLifecycle, state: &mut Inner) {
        gate.thaw();
        state.snapshot.phase = Phase::Ready;
        state.snapshot.preparation_id = None;
    }
    fn report_ready(&self, label: &str, identity: usize, ready: bool) {
        let mut gate = self.gate.0.lock().unwrap();
        let Some(entry) = gate
            .windows
            .get_mut(label)
            .filter(|w| w.identity == Some(identity))
        else {
            return;
        };
        entry.ready = ready.then(tokio::time::Instant::now);
        // A delayed unsafe report must invalidate a preparation, never authorize installation.
        if !ready && gate.preparation.is_some() {
            let mut state = self.inner.lock().unwrap();
            Self::abort_preparation(&mut gate, &mut state);
        }
    }
    fn report_prepared(&self, label: &str, identity: usize, attempt: &str, ready: bool) {
        let mut gate = self.gate.0.lock().unwrap();
        if !gate
            .preparation
            .as_ref()
            .is_some_and(|(id, _)| id == attempt)
        {
            return;
        }
        let Some(entry) = gate
            .windows
            .get_mut(label)
            .filter(|w| w.identity == Some(identity))
        else {
            return;
        };
        if ready {
            entry.prepared = Some(tokio::time::Instant::now());
        } else {
            let mut state = self.inner.lock().unwrap();
            Self::abort_preparation(&mut gate, &mut state);
        }
    }
    fn take_ready(&self, prepare: impl FnOnce() -> bool) -> Result<Staged, UpdateError> {
        // Lock order: window lifecycle, updater state, then backend admission.
        let mut gate = self.gate.0.lock().unwrap();
        let mut state = self.inner.lock().unwrap();
        if self.cancel.is_cancelled() {
            return Err(UpdateError::Stopped);
        }
        if state.snapshot.phase == Phase::Restarting {
            return Err(UpdateError::Busy);
        }
        if state.staged.is_none() {
            return Err(UpdateError::NotReady);
        }
        if state.snapshot.phase != Phase::Preparing {
            return Err(UpdateError::Busy);
        }
        let Some((_, started)) = &gate.preparation else {
            return Err(UpdateError::Busy);
        };
        if started.elapsed() >= PREPARATION_TIMEOUT {
            Self::abort_preparation(&mut gate, &mut state);
            return Err(UpdateError::TimedOut);
        }
        if !gate.all_prepared() {
            return Err(UpdateError::Busy);
        }
        if !prepare() {
            Self::abort_preparation(&mut gate, &mut state);
            return Err(UpdateError::Busy);
        }
        let staged = state.staged.take().unwrap();
        gate.preparation = None;
        gate.restarting = true;
        state.snapshot.phase = Phase::Restarting;
        state.snapshot.preparation_id = None;
        Ok(staged)
    }
    async fn install_ready(&self, app: &AppHandle) -> Result<(), UpdateError> {
        let staged = self.take_ready(|| {
            let connections = app.state::<Arc<crate::connection::ConnectionEngine>>();
            connections.prepare_update_shutdown()
        })?;
        let connections = app.state::<Arc<crate::connection::ConnectionEngine>>();
        connections.drain().await;
        if self.cancel.is_cancelled() {
            return Err(UpdateError::Stopped);
        }
        let result = tauri::async_runtime::spawn_blocking(move || staged.package.install())
            .await
            .map_err(|_| UpdateError::InstallFailed)
            .and_then(|result| result);
        if let Err(error) = result {
            connections.finish_update_failure();
            let mut gate = self.gate.0.lock().unwrap();
            gate.thaw();
            let mut state = self.inner.lock().unwrap();
            state.snapshot = UpdateSnapshot {
                phase: Phase::Error,
                version: None,
                error: Some(error.clone()),
                preparation_id: None,
            };
            return Err(error);
        }
        // request_restart returns so this tracked worker can finish before exit drains it.
        app.request_restart();
        Ok(())
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
fn asset_allowed(url: &Url, version: &str, target: Target) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && [version.to_owned(), format!("v{version}")]
            .iter()
            .any(|tag| {
                url.path()
                    == format!(
                        "/yan-ad/iceon/releases/download/{tag}/{}",
                        target.asset(version)
                    )
            })
}
fn client(proxy: Option<&Url>) -> Result<reqwest::Client, UpdateError> {
    crate::tls::initialize();
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
                && url.port().is_none()
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
    target: Target,
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
            let json: serde_json::Value =
                serde_json::from_slice(&metadata).map_err(|_| UpdateError::InvalidRelease)?;
            let raw_asset = json
                .get("platforms")
                .and_then(|platforms| platforms.get(self.target.key()))
                .and_then(|platform| platform.get("url"))
                .and_then(|url| url.as_str())
                .map(str::to_owned);
            let updater = self
                .app
                .updater_builder()
                .pubkey(&self.key)
                .target(self.target.key())
                .build()
                .map_err(|_| UpdateError::CheckFailed)?;
            let Some(update) = updater
                .restore_update(json)
                .map_err(|_| UpdateError::InvalidRelease)?
            else {
                return Ok(None);
            };
            if !newer_release(&update.version, &update.current_version)? {
                return Ok(None);
            }
            if raw_asset.as_deref() != Some(update.download_url.as_str())
                || !asset_allowed(&update.download_url, &update.version, self.target)
                || update.version.len() > 100
            {
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
    engine: tauri::State<'_, Arc<UpdateEngine>>,
) -> Result<(), UpdateError> {
    engine.begin_preparation()
}
#[tauri::command]
pub fn update_window_ready(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, Arc<UpdateEngine>>,
    ready: bool,
) {
    if let Some(identity) = window_identity(&window) {
        engine.report_ready(window.label(), identity, ready);
    }
}
#[tauri::command]
pub fn update_window_prepared(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, Arc<UpdateEngine>>,
    attempt: String,
    ready: bool,
) {
    if let Some(identity) = window_identity(&window) {
        engine.report_prepared(window.label(), identity, &attempt, ready);
    }
}
fn newer_release(version: &str, current: &str) -> Result<bool, UpdateError> {
    let version = semver::Version::parse(version).map_err(|_| UpdateError::InvalidRelease)?;
    let current = semver::Version::parse(current).map_err(|_| UpdateError::InvalidRelease)?;
    if !version.pre.is_empty() || !version.build.is_empty() || version.to_string().len() > 50 {
        return Ok(false);
    }
    Ok(version.cmp_precedence(&current).is_gt())
}
#[cfg(test)]
#[path = "updates_tests.rs"]
mod tests;
