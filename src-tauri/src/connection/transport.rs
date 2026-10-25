use super::{ConnectionError, ResourceKind, ResourcePage, ResourceRequest, Result};
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
pub(super) mod nodes;

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
    validate_resource_request(request)?;
    let path = resource_path(request);
    let accept = if matches!(
        request.kind,
        ResourceKind::Secrets | ResourceKind::ConfigMaps
    ) {
        "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1"
    } else {
        "application/json"
    };
    let list: List = get_with_accept(client, &path, BODY_LIMIT, cancel, accept).await?;
    if matches!(
        request.kind,
        ResourceKind::Secrets | ResourceKind::ConfigMaps
    ) && list.kind.as_deref() != Some("PartialObjectMetadataList")
    {
        return Err(ConnectionError::InvalidResponse);
    }
    if list.items.len() > ITEM_LIMIT {
        return Err(ConnectionError::LimitExceeded);
    }
    let continue_token = list.metadata.continue_token.filter(|s| !s.is_empty());
    if continue_token.as_deref().is_some_and(|s| !valid_token(s)) {
        return Err(ConnectionError::InvalidResponse);
    }
    let mut names = HashSet::new();
    let mut items = Vec::new();
    for raw in list.items {
        let item = super::resources::project(request.kind, raw)?;
        if !names.insert((item.namespace.clone(), item.name.clone()))
            || (request.namespace.is_some() && item.namespace != request.namespace)
            || (!super::resources::namespaced(request.kind) && item.namespace.is_some())
        {
            return Err(ConnectionError::InvalidResponse);
        }
        items.push(item);
    }
    items.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
    let metrics = if request.kind == ResourceKind::Nodes {
        Some(super::metrics::enrich(client, &mut items, cancel).await?)
    } else {
        None
    };
    Ok(ResourcePage {
        cluster_id: request.cluster_id.clone(),
        session_id: request.session_id.clone(),
        kind: request.kind,
        read_id: request.read_id,
        namespace: request.namespace.clone(),
        truncated: continue_token.is_some(),
        continue_token,
        items,
        metrics,
        fetched_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ConnectionError::ConnectionFailed)?
            .as_millis() as u64,
    })
}
pub(super) fn valid_namespace(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.as_bytes()[s.len() - 1].is_ascii_alphanumeric()
}
fn valid_token(s: &str) -> bool {
    s.len() <= 4096 && !s.chars().any(char::is_control)
}
pub(super) fn validate_resource_request(request: &ResourceRequest) -> Result<()> {
    if request
        .namespace
        .as_deref()
        .is_some_and(|s| !super::resources::namespaced(request.kind) || !valid_namespace(s))
        || request
            .continue_token
            .as_deref()
            .is_some_and(|s| !valid_token(s))
    {
        return Err(ConnectionError::InvalidInput);
    }
    Ok(())
}
pub(super) fn resource_path(request: &ResourceRequest) -> String {
    use ResourceKind::*;
    let (group, plural) = match request.kind {
        Nodes => ("/api/v1", "nodes"),
        Namespaces => ("/api/v1", "namespaces"),
        Pods => ("/api/v1", "pods"),
        ConfigMaps => ("/api/v1", "configmaps"),
        Secrets => ("/api/v1", "secrets"),
        ResourceQuotas => ("/api/v1", "resourcequotas"),
        LimitRanges => ("/api/v1", "limitranges"),
        Services => ("/api/v1", "services"),
        Endpoints => ("/api/v1", "endpoints"),
        PersistentVolumes => ("/api/v1", "persistentvolumes"),
        PersistentVolumeClaims => ("/api/v1", "persistentvolumeclaims"),
        Events => ("/api/v1", "events"),
        ServiceAccounts => ("/api/v1", "serviceaccounts"),
        Deployments => ("/apis/apps/v1", "deployments"),
        DaemonSets => ("/apis/apps/v1", "daemonsets"),
        StatefulSets => ("/apis/apps/v1", "statefulsets"),
        ReplicaSets => ("/apis/apps/v1", "replicasets"),
        ReplicationControllers => ("/api/v1", "replicationcontrollers"),
        Jobs => ("/apis/batch/v1", "jobs"),
        CronJobs => ("/apis/batch/v1", "cronjobs"),
        HorizontalPodAutoscalers => ("/apis/autoscaling/v2", "horizontalpodautoscalers"),
        VerticalPodAutoscalers => ("/apis/autoscaling.k8s.io/v1", "verticalpodautoscalers"),
        PodDisruptionBudgets => ("/apis/policy/v1", "poddisruptionbudgets"),
        PriorityClasses => ("/apis/scheduling.k8s.io/v1", "priorityclasses"),
        RuntimeClasses => ("/apis/node.k8s.io/v1", "runtimeclasses"),
        Leases => ("/apis/coordination.k8s.io/v1", "leases"),
        Ingresses => ("/apis/networking.k8s.io/v1", "ingresses"),
        IngressClasses => ("/apis/networking.k8s.io/v1", "ingressclasses"),
        NetworkPolicies => ("/apis/networking.k8s.io/v1", "networkpolicies"),
        EndpointSlices => ("/apis/discovery.k8s.io/v1", "endpointslices"),
        MutatingWebhookConfigurations => (
            "/apis/admissionregistration.k8s.io/v1",
            "mutatingwebhookconfigurations",
        ),
        ValidatingWebhookConfigurations => (
            "/apis/admissionregistration.k8s.io/v1",
            "validatingwebhookconfigurations",
        ),
        ValidatingAdmissionPolicies => (
            "/apis/admissionregistration.k8s.io/v1",
            "validatingadmissionpolicies",
        ),
        ValidatingAdmissionPolicyBindings => (
            "/apis/admissionregistration.k8s.io/v1",
            "validatingadmissionpolicybindings",
        ),
        PodSecurityPolicies => ("/apis/policy/v1beta1", "podsecuritypolicies"),
        StorageClasses => ("/apis/storage.k8s.io/v1", "storageclasses"),
        Roles => ("/apis/rbac.authorization.k8s.io/v1", "roles"),
        RoleBindings => ("/apis/rbac.authorization.k8s.io/v1", "rolebindings"),
        ClusterRoles => ("/apis/rbac.authorization.k8s.io/v1", "clusterroles"),
        ClusterRoleBindings => ("/apis/rbac.authorization.k8s.io/v1", "clusterrolebindings"),
        CustomResourceDefinitions => ("/apis/apiextensions.k8s.io/v1", "customresourcedefinitions"),
    };
    let scope = request
        .namespace
        .as_ref()
        .map(|s| format!("/namespaces/{s}"))
        .unwrap_or_default();
    let mut path = format!("{group}{scope}/{plural}?limit=100&timeoutSeconds=10");
    if let Some(token) = &request.continue_token {
        let query: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("continue", token)
            .finish();
        path.push('&');
        path.push_str(&query);
    }
    path
}

// Only this allowlisted request path reaches the client. API error bodies are never surfaced.
pub(super) async fn get<T: DeserializeOwned>(
    client: &Client,
    path: &str,
    limit: usize,
    cancel: &CancellationToken,
) -> Result<T> {
    get_with_accept(client, path, limit, cancel, "application/json").await
}
async fn get_with_accept<T: DeserializeOwned>(
    client: &Client,
    path: &str,
    limit: usize,
    cancel: &CancellationToken,
    accept: &str,
) -> Result<T> {
    let mut request = Request::get(path)
        .header("Accept", accept)
        .body(Body::empty())
        .map_err(|_| ConnectionError::InvalidInput)?;
    request.extensions_mut().insert(cancel.clone());
    let mut response = client.send(request).await.map_err(map_kube_error)?;
    match response.status().as_u16() {
        200 => {}
        401 => return Err(ConnectionError::AuthFailed),
        403 => return Err(ConnectionError::PermissionDenied),
        404 => return Err(ConnectionError::ResourceUnavailable),
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
    kind: Option<String>,
    #[serde(default)]
    metadata: ListMetadata,
    items: Vec<serde_json::Value>,
}
#[derive(Default, Deserialize)]
struct ListMetadata {
    #[serde(default, rename = "continue")]
    continue_token: Option<String>,
}
