use super::{ConnectionError, ResourceItem, ResourceKind, ResourcePage, ResourceRequest, Result};
use http::Request;
use http_body_util::BodyExt;
use kube::{Client, client::Body};
use serde::{Deserialize, de::DeserializeOwned};
use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

const BODY_LIMIT: usize = 2 * 1024 * 1024;
const ITEM_LIMIT: usize = 100;

#[derive(Clone)]
pub(super) struct CancelService<S>(pub S);
impl<S, B> tower::Service<Request<Body>> for CancelService<S>
where
    S: tower::Service<Request<Body>, Response = http::Response<B>>,
    S::Future: Send + 'static,
    S::Error: Into<tower::BoxError>,
    B: Send + 'static,
{
    type Response = http::Response<B>;
    type Error = tower::BoxError;
    type Future = std::pin::Pin<
        Box<
            dyn std::future::Future<Output = std::result::Result<Self::Response, Self::Error>>
                + Send,
        >,
    >;
    fn poll_ready(
        &mut self,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::result::Result<(), Self::Error>> {
        self.0.poll_ready(cx).map_err(Into::into)
    }
    fn call(&mut self, request: Request<Body>) -> Self::Future {
        let cancel = request
            .extensions()
            .get::<CancellationToken>()
            .cloned()
            .unwrap_or_default();
        let future = self.0.call(request);
        Box::pin(async move {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "request cancelled").into()),
                result = tokio::time::timeout(super::DEADLINE, future) => result.map_err(|_| -> tower::BoxError { std::io::Error::new(std::io::ErrorKind::TimedOut, "request deadline").into() })?.map_err(Into::into),
            }
        })
    }
}

pub(super) async fn version(client: &Client, cancel: &CancellationToken) -> Result<String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Version {
        git_version: String,
    }

    let version: Version = get(client, "/version", 64 * 1024, cancel).await?;
    if version.git_version.is_empty()
        || version.git_version.len() > 256
        || version.git_version.chars().any(char::is_control)
    {
        return Err(ConnectionError::InvalidResponse);
    }
    Ok(version.git_version)
}

pub(super) async fn resources(
    client: &Client,
    request: &ResourceRequest,
    cancel: &CancellationToken,
) -> Result<ResourcePage> {
    let path = match request.kind {
        ResourceKind::Nodes => "/api/v1/nodes?limit=100&timeoutSeconds=10",
        ResourceKind::Namespaces => "/api/v1/namespaces?limit=100&timeoutSeconds=10",
    };
    let list: List = get(client, path, BODY_LIMIT, cancel).await?;
    if list.items.len() > ITEM_LIMIT {
        return Err(ConnectionError::LimitExceeded);
    }
    let mut names = HashSet::new();
    let mut items = Vec::new();
    for item in list.items {
        let name = item.metadata.name;
        if !valid_name(&name) || !names.insert(name.clone()) {
            return Err(ConnectionError::InvalidResponse);
        }
        let status = match request.kind {
            ResourceKind::Nodes => match item
                .status
                .conditions
                .iter()
                .find(|condition| condition.kind == "Ready")
                .map(|c| c.status.as_str())
            {
                Some("True") => "Ready",
                Some("False") => "Not ready",
                _ => "Unknown",
            },
            ResourceKind::Namespaces => match item.status.phase.as_deref() {
                Some("Active") => "Active",
                Some("Terminating") => "Terminating",
                _ => "Unknown",
            },
        };
        items.push(ResourceItem {
            name,
            status: status.into(),
        });
    }
    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ResourcePage {
        cluster_id: request.cluster_id.clone(),
        session_id: request.session_id.clone(),
        kind: request.kind,
        read_id: request.read_id,
        items,
        truncated: !list.metadata.continue_token.is_empty(),
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ConnectionError::ConnectionFailed)?
            .as_millis() as u64,
    })
}
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 253
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'.'))
}

// Only this allowlisted request path reaches the client. API error bodies are never surfaced.
async fn get<T: DeserializeOwned>(
    client: &Client,
    path: &str,
    limit: usize,
    cancel: &CancellationToken,
) -> Result<T> {
    let mut request = Request::get(path)
        .header("Accept", "application/json")
        .body(Body::empty())
        .map_err(|_| ConnectionError::InvalidInput)?;
    request.extensions_mut().insert(cancel.clone());
    let mut response = client.send(request).await.map_err(map_kube_error)?;
    match response.status().as_u16() {
        200 => {}
        401 => return Err(ConnectionError::AuthFailed),
        403 => return Err(ConnectionError::PermissionDenied),
        408 | 504 => return Err(ConnectionError::Timeout),
        _ => return Err(ConnectionError::ConnectionFailed),
    }
    if response
        .headers()
        .get("content-length")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<usize>().ok())
        .is_some_and(|length| length > limit)
    {
        return Err(ConnectionError::LimitExceeded);
    }
    let mut bytes = Vec::new();
    while let Some(frame) = response.body_mut().frame().await {
        let frame = frame.map_err(map_kube_error)?;
        if let Ok(data) = frame.into_data() {
            if data.len() > limit.saturating_sub(bytes.len()) {
                return Err(ConnectionError::LimitExceeded);
            }
            bytes.extend_from_slice(&data);
        }
    }
    serde_json::from_slice(&bytes).map_err(|_| ConnectionError::InvalidResponse)
}
fn map_kube_error(error: kube::Error) -> ConnectionError {
    match error {
        kube::Error::Auth(_) => ConnectionError::AuthFailed,
        kube::Error::RustlsTls(_) | kube::Error::TlsRequired => ConnectionError::TlsFailed,
        kube::Error::Service(error) => {
            let mut cause: Option<&(dyn std::error::Error + 'static)> = Some(error.as_ref());
            for _ in 0..16 {
                let Some(current) = cause else {
                    break;
                };
                if current.is::<rustls::Error>() {
                    return ConnectionError::TlsFailed;
                }
                if let Some(io) = current.downcast_ref::<std::io::Error>()
                    && io.kind() == std::io::ErrorKind::TimedOut
                {
                    return ConnectionError::Timeout;
                }
                cause = current.source();
            }
            ConnectionError::Network
        }
        _ => ConnectionError::Network,
    }
}
#[derive(Deserialize)]
struct List {
    #[serde(default)]
    metadata: ListMetadata,
    items: Vec<Item>,
}
#[derive(Default, Deserialize)]
struct ListMetadata {
    #[serde(default, rename = "continue")]
    continue_token: String,
}
#[derive(Deserialize)]
struct Item {
    metadata: Metadata,
    #[serde(default)]
    status: Status,
}
#[derive(Deserialize)]
struct Metadata {
    name: String,
}
#[derive(Default, Deserialize)]
struct Status {
    #[serde(default)]
    conditions: Vec<Condition>,
    phase: Option<String>,
}
#[derive(Deserialize)]
struct Condition {
    #[serde(rename = "type")]
    kind: String,
    status: String,
}
