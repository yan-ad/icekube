use super::{
    ConnectionEngine, ConnectionError, Result, SessionRequest, auth, config, current,
    validate_credentials, validate_read_id, validate_request,
};
use process_wrap::tokio::{CommandWrap, KillOnDrop};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap, ffi::OsString, io::Write, path::PathBuf, process::Stdio, sync::Mutex,
};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_util::sync::CancellationToken;

const OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
const ITEM_LIMIT: usize = 500;

#[path = "helm_install.rs"]
pub(crate) mod install;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum HelmView {
    Charts,
    Releases,
}

impl Drop for HelmRuntime {
    fn drop(&mut self) {
        if let Ok(slots) = self.slots.get_mut() {
            for slot in slots.values() {
                if let Some(cancel) = &slot.cancel {
                    cancel.cancel();
                }
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelmCancelRequest {
    pub cluster_id: String,
    pub session_id: String,
    pub view: HelmView,
    pub read_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct HelmScope {
    cluster_id: String,
    session_id: String,
    view: HelmView,
}

#[derive(Debug)]
struct HelmSlot {
    read_id: u64,
    cancel: Option<CancellationToken>,
    root: CancellationToken,
}

#[derive(Debug, Default)]
pub struct HelmRuntime {
    install: install::InstallRuntime,
    slots: Mutex<HashMap<HelmScope, HelmSlot>>,
}

impl HelmRuntime {
    const CAP: usize = 4;

    fn token(&self, request: &HelmRequest, root: &CancellationToken) -> Result<CancellationToken> {
        validate_read_id(request.read_id)?;
        let scope = HelmScope {
            cluster_id: request.cluster_id.clone(),
            session_id: request.session_id.clone(),
            view: request.view,
        };
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        slots.retain(|_, slot| !slot.root.is_cancelled());
        if root.is_cancelled()
            || slots
                .get(&scope)
                .is_some_and(|slot| request.read_id <= slot.read_id)
        {
            return Err(ConnectionError::StaleSession);
        }
        if !slots.contains_key(&scope) && slots.len() >= Self::CAP {
            return Err(ConnectionError::Busy);
        }
        let token = root.child_token();
        if let Some(old) = slots.insert(
            scope,
            HelmSlot {
                read_id: request.read_id,
                cancel: Some(token.clone()),
                root: root.clone(),
            },
        ) && let Some(cancel) = old.cancel
        {
            cancel.cancel();
        }
        Ok(token)
    }

    fn cancel(&self, request: &HelmCancelRequest, root: &CancellationToken) -> Result<()> {
        validate_request(&SessionRequest {
            cluster_id: request.cluster_id.clone(),
            session_id: request.session_id.clone(),
        })?;
        validate_read_id(request.read_id)?;
        let scope = HelmScope {
            cluster_id: request.cluster_id.clone(),
            session_id: request.session_id.clone(),
            view: request.view,
        };
        let mut slots = self
            .slots
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        slots.retain(|_, slot| !slot.root.is_cancelled());
        if root.is_cancelled() {
            return Ok(());
        }
        if let Some(slot) = slots.get_mut(&scope) {
            if request.read_id >= slot.read_id {
                if let Some(cancel) = slot.cancel.take() {
                    cancel.cancel();
                }
                slot.read_id = request.read_id;
            }
        } else {
            if slots.len() >= Self::CAP {
                return Err(ConnectionError::Busy);
            }
            slots.insert(
                scope,
                HelmSlot {
                    read_id: request.read_id,
                    cancel: None,
                    root: root.clone(),
                },
            );
        }
        Ok(())
    }

    fn finish(&self, request: &HelmRequest) {
        let scope = HelmScope {
            cluster_id: request.cluster_id.clone(),
            session_id: request.session_id.clone(),
            view: request.view,
        };
        if let Ok(mut slots) = self.slots.lock()
            && let Some(slot) = slots.get_mut(&scope)
            && slot.read_id == request.read_id
            && let Some(cancel) = slot.cancel.take()
        {
            cancel.cancel();
        }
    }
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelmRequest {
    pub cluster_id: String,
    pub session_id: String,
    pub view: HelmView,
    pub namespace: Option<String>,
    pub read_id: u64,
}
impl HelmRequest {
    fn session(&self) -> SessionRequest {
        SessionRequest {
            cluster_id: self.cluster_id.clone(),
            session_id: self.session_id.clone(),
        }
    }
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelmPage {
    pub cluster_id: String,
    pub session_id: String,
    pub view: HelmView,
    pub items: Vec<HelmItem>,
    pub truncated: bool,
    pub read_id: u64,
    pub namespace: Option<String>,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelmItem {
    pub id: String,
    pub name: String,
    pub namespace: Option<String>,
    pub version: String,
    pub app_version: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub revision: Option<u32>,
    pub updated: Option<String>,
}

impl ConnectionEngine {
    pub async fn helm_table(&self, request: HelmRequest) -> Result<HelmPage> {
        validate_read_id(request.read_id)?;
        validate_request(&request.session())?;
        validate_namespace(&request)?;
        let _permit = self
            .workers
            .try_acquire()
            .map_err(|_| ConnectionError::Busy)?;
        let (target, session_cancel) = {
            let state = self
                .session
                .lock()
                .map_err(|_| ConnectionError::StoreUnavailable)?;
            let session = current(&state, &request.session())?;
            validate_credentials(
                session
                    .client
                    .as_ref()
                    .ok_or(ConnectionError::NotConnected)?,
            )?;
            (session.target.clone(), session.cancel.child_token())
        };
        let runtime = &self.helm_runtime;
        let cancel = runtime.token(&request, &session_cancel)?;
        let _read_guard = CancelOnDrop(cancel.clone());
        let result = super::bounded(&cancel, async {
            let executable = executable()?;
            let catalog = self.catalog.clone();
            let id = request.cluster_id.clone();
            let expected = target.clone();
            let file_permit = self
                .file_workers
                .clone()
                .try_acquire_owned()
                .map_err(|_| ConnectionError::Busy)?;
            let (prepared, file) = tauri::async_runtime::spawn_blocking(move || {
                let _permit = file_permit;
                let latest = catalog
                    .connection_target(&id)
                    .map_err(super::map_catalog_error)?;
                if latest != expected {
                    return Err(ConnectionError::SourceChanged);
                }
                let prepared = if request.view == HelmView::Releases {
                    Some(config::prepare(&expected)?)
                } else {
                    None
                };
                let file = tempfile::NamedTempFile::new()
                    .map_err(|_| ConnectionError::KubeconfigUnavailable)?;
                Ok((prepared, file))
            })
            .await
            .map_err(|_| ConnectionError::KubeconfigUnavailable)??;
            let mut file = file;
            if let Some(mut prepared) = prepared {
                let base = target
                    .source_path
                    .parent()
                    .ok_or(ConnectionError::KubeconfigUnavailable)?;
                auth::resolve_tracked(&mut prepared, base, &self.auth_tasks).await?;
                let yaml = serde_yaml_ng::to_string(&prepared)
                    .map_err(|_| ConnectionError::KubeconfigInvalid)?;
                file.write_all(yaml.as_bytes())
                    .map_err(|_| ConnectionError::KubeconfigUnavailable)?;
                file.flush()
                    .map_err(|_| ConnectionError::KubeconfigUnavailable)?;
            }
            self.check_pod_session(&request.session())?;
            let output = self
                .auth_tasks
                .spawn(supervise(
                    executable,
                    arguments(request.view, request.namespace.as_deref()),
                    file,
                    cancel.clone(),
                ))
                .await
                .map_err(|_| ConnectionError::ConnectionFailed)??;
            project(&request, &output)
        })
        .await;
        let canceled = cancel.is_cancelled();
        runtime.finish(&request);
        self.check_pod_session(&request.session())?;
        if canceled {
            Err(ConnectionError::StaleSession)
        } else {
            result
        }
    }

    pub fn helm_cancel(&self, request: HelmCancelRequest) -> Result<()> {
        validate_request(&SessionRequest {
            cluster_id: request.cluster_id.clone(),
            session_id: request.session_id.clone(),
        })?;
        validate_read_id(request.read_id)?;
        let state = self
            .session
            .lock()
            .map_err(|_| ConnectionError::StoreUnavailable)?;
        let scope = SessionRequest {
            cluster_id: request.cluster_id.clone(),
            session_id: request.session_id.clone(),
        };
        // A closed lease is already canceled; never register it against a new lease.
        if let Ok(session) = current(&state, &scope) {
            self.helm_runtime.cancel(&request, &session.cancel)?;
        }
        Ok(())
    }
}

fn validate_namespace(request: &HelmRequest) -> Result<()> {
    if let Some(namespace) = &request.namespace
        && (request.view != HelmView::Releases
            || namespace.is_empty()
            || namespace.len() > 63
            || !namespace
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
            || namespace.starts_with('-')
            || namespace.ends_with('-'))
    {
        return Err(ConnectionError::InvalidInput);
    }
    Ok(())
}
fn arguments(view: HelmView, namespace: Option<&str>) -> Vec<OsString> {
    match view {
        HelmView::Charts => ["search", "repo", "-o", "json"]
            .map(OsString::from)
            .to_vec(),
        HelmView::Releases => {
            let mut args = vec![OsString::from("list"), OsString::from("--all")];
            match namespace {
                Some(namespace) => {
                    args.push("--namespace".into());
                    args.push(namespace.into());
                }
                None => args.push("--all-namespaces".into()),
            }
            args.extend(["--output".into(), "json".into()]);
            args
        }
    }
}
fn executable() -> Result<PathBuf> {
    let path = std::env::var_os("PATH").ok_or(ConnectionError::HelmUnavailable)?;
    lookup_executable(&path)
}
fn lookup_executable(path: &std::ffi::OsStr) -> Result<PathBuf> {
    for directory in std::env::split_paths(path) {
        if !directory.is_absolute() {
            continue;
        }
        let name = if cfg!(windows) { "helm.exe" } else { "helm" };
        let Ok(candidate) = std::fs::canonicalize(directory.join(name)) else {
            continue;
        };
        let Ok(metadata) = candidate.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                continue;
            }
        }
        return Ok(candidate);
    }
    Err(ConnectionError::HelmUnavailable)
}
struct CancelOnDrop(CancellationToken);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
    }
}

async fn supervise(
    executable: PathBuf,
    args: Vec<OsString>,
    file: tempfile::NamedTempFile,
    cancel: CancellationToken,
) -> Result<Vec<u8>> {
    supervise_with_deadline(executable, args, file, cancel, super::DEADLINE).await
}

async fn supervise_with_deadline(
    executable: PathBuf,
    args: Vec<OsString>,
    file: tempfile::NamedTempFile,
    cancel: CancellationToken,
    deadline: std::time::Duration,
) -> Result<Vec<u8>> {
    supervise_owned(executable, args, file, cancel, deadline, None).await
}

async fn supervise_owned(
    executable: PathBuf,
    args: Vec<OsString>,
    file: tempfile::NamedTempFile,
    cancel: CancellationToken,
    deadline: std::time::Duration,
    directory: Option<tempfile::TempDir>,
) -> Result<Vec<u8>> {
    if cancel.is_cancelled() {
        return Err(ConnectionError::StaleSession);
    }
    let retain = directory.is_none();
    let mut command = CommandWrap::with_new(executable, |command| {
        if let Some(directory) = &directory {
            command.current_dir(directory.path());
        }
        command
            .args(args)
            .env_remove("HELM_DEBUG")
            .env("KUBECONFIG", file.path())
            .env("HELM_DRIVER", "secret")
            .env_remove("HELM_KUBECONTEXT")
            .env_remove("HELM_KUBEAPISERVER")
            .env_remove("HELM_KUBETOKEN")
            .env_remove("HELM_KUBECAFILE")
            .env_remove("HELM_KUBEINSECURE_SKIP_TLS_VERIFY")
            .env_remove("HELM_KUBETLS_SERVER_NAME")
            .env_remove("HELM_KUBEASUSER")
            .env_remove("HELM_KUBEASGROUPS")
            .env_remove("HTTP_PROXY")
            .env_remove("HTTPS_PROXY")
            .env_remove("ALL_PROXY")
            .env_remove("http_proxy")
            .env_remove("https_proxy")
            .env_remove("all_proxy")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    });
    command.wrap(KillOnDrop);
    #[cfg(unix)]
    command.wrap(process_wrap::tokio::ProcessGroup::leader());
    #[cfg(windows)]
    command.wrap(process_wrap::tokio::JobObject);
    let mut child = command
        .spawn()
        .map_err(|_| ConnectionError::HelmUnavailable)?;
    let stdout = child
        .stdout()
        .take()
        .ok_or(ConnectionError::ConnectionFailed)?;
    let stderr = child
        .stderr()
        .take()
        .ok_or(ConnectionError::ConnectionFailed)?;
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ConnectionError::StaleSession),
        result = tokio::time::timeout(deadline, async {
            let (status, output, _) = tokio::try_join!(
                async { child.wait().await.map_err(|_| ConnectionError::ConnectionFailed) },
                read_output(stdout, retain), read_output(stderr, false))?;
            if !status.success() { return Err(ConnectionError::Conflict); }
            Ok(output)
        }) => result.unwrap_or(Err(ConnectionError::Timeout)),
    };
    let _ = child.start_kill();
    let _ = child.wait().await;
    drop(file);
    drop(directory);
    result
}
async fn read_output(mut reader: impl AsyncRead + Unpin, retain: bool) -> Result<Vec<u8>> {
    let mut output = Vec::new();
    let mut total = 0;
    let mut buffer = [0; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|_| ConnectionError::ConnectionFailed)?;
        if count == 0 {
            return Ok(output);
        }
        total += count;
        if total > OUTPUT_LIMIT {
            return Err(ConnectionError::LimitExceeded);
        }
        if retain {
            output.extend_from_slice(&buffer[..count]);
        }
    }
}
fn field(value: &Value, key: &str, required: bool) -> Result<String> {
    let text = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidResponse)?;
    if text.len() > 4096 || text.chars().any(char::is_control) || (required && text.is_empty()) {
        return Err(ConnectionError::InvalidResponse);
    }
    Ok(text.to_owned())
}
fn project(request: &HelmRequest, bytes: &[u8]) -> Result<HelmPage> {
    if bytes.len() > OUTPUT_LIMIT {
        return Err(ConnectionError::LimitExceeded);
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| ConnectionError::InvalidResponse)?;
    let rows = value.as_array().ok_or(ConnectionError::InvalidResponse)?;
    let mut items = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for row in rows.iter().take(ITEM_LIMIT) {
        let name = field(row, "name", true)?;
        let (namespace, version, status, revision, updated, description) = match request.view {
            HelmView::Charts => (
                None,
                field(row, "version", true)?,
                None,
                None,
                None,
                Some(field(row, "description", false)?),
            ),
            HelmView::Releases => {
                let namespace = field(row, "namespace", true)?;
                let check = HelmRequest {
                    namespace: Some(namespace.clone()),
                    ..request.clone()
                };
                validate_namespace(&check).map_err(|_| ConnectionError::InvalidResponse)?;
                if request
                    .namespace
                    .as_ref()
                    .is_some_and(|selected| selected != &namespace)
                {
                    return Err(ConnectionError::InvalidResponse);
                }
                let revision = field(row, "revision", true)?
                    .parse::<u32>()
                    .map_err(|_| ConnectionError::InvalidResponse)?;
                (
                    Some(namespace),
                    field(row, "chart", true)?,
                    Some(field(row, "status", true)?),
                    Some(revision),
                    Some(field(row, "updated", false)?),
                    None,
                )
            }
        };
        let id = serde_json::to_string(&(&namespace, &name))
            .map_err(|_| ConnectionError::InvalidResponse)?;
        if !ids.insert(id.clone()) {
            return Err(ConnectionError::InvalidResponse);
        }
        items.push(HelmItem {
            id,
            name,
            namespace,
            version,
            app_version: field(row, "app_version", false)?,
            description,
            status,
            revision,
            updated,
        });
    }
    // Helm list defaults to 256 entries and does not expose a total in JSON.
    let truncated =
        rows.len() > ITEM_LIMIT || (request.view == HelmView::Releases && rows.len() >= 256);
    Ok(HelmPage {
        cluster_id: request.cluster_id.clone(),
        session_id: request.session_id.clone(),
        view: request.view,
        items,
        truncated,
        read_id: request.read_id,
        namespace: request.namespace.clone(),
    })
}

#[cfg(test)]
#[path = "helm_tests.rs"]
mod tests;
