use super::{ConnectionError, NodeInfo, ResourceItem, ResourceKind, Usage};
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) fn namespaced(kind: ResourceKind) -> bool {
    matches!(
        kind,
        ResourceKind::Pods
            | ResourceKind::Deployments
            | ResourceKind::DaemonSets
            | ResourceKind::StatefulSets
            | ResourceKind::ReplicaSets
            | ResourceKind::Jobs
            | ResourceKind::CronJobs
            | ResourceKind::ConfigMaps
            | ResourceKind::Secrets
            | ResourceKind::ResourceQuotas
            | ResourceKind::LimitRanges
            | ResourceKind::HorizontalPodAutoscalers
            | ResourceKind::PodDisruptionBudgets
            | ResourceKind::Services
            | ResourceKind::Endpoints
            | ResourceKind::Ingresses
            | ResourceKind::NetworkPolicies
            | ResourceKind::PersistentVolumeClaims
            | ResourceKind::Events
            | ResourceKind::ServiceAccounts
            | ResourceKind::Roles
            | ResourceKind::RoleBindings
    )
}
fn rbac_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    for (key, path) in [("rules", "/rules"), ("subjects", "/subjects")] {
        if let Some(values) = v.pointer(path).and_then(Value::as_array) {
            insert(c, key, values.len().to_string());
        }
    }
    if let Some(name) = v.pointer("/roleRef/name").and_then(Value::as_str) {
        insert(c, "roleRef", bounded(name));
    }
    "Unknown".into()
}

pub(super) fn project(kind: ResourceKind, value: Value) -> Result<ResourceItem, ConnectionError> {
    let meta = value
        .get("metadata")
        .ok_or(ConnectionError::InvalidResponse)?;
    let name = meta
        .get("name")
        .and_then(Value::as_str)
        .ok_or(ConnectionError::InvalidResponse)?
        .to_owned();
    if !valid_name(&name) {
        return Err(ConnectionError::InvalidResponse);
    }
    let namespace = meta.get("namespace").and_then(Value::as_str).map(bounded);
    if namespace
        .as_deref()
        .is_some_and(|v| !super::transport::valid_namespace(v))
        || (namespaced(kind) && namespace.is_none())
    {
        return Err(ConnectionError::InvalidResponse);
    }
    let created_at = meta
        .get("creationTimestamp")
        .and_then(Value::as_str)
        .and_then(timestamp);
    let mut columns = BTreeMap::new();
    let status = match kind {
        ResourceKind::Nodes => project_node(&value, &mut columns)?,
        ResourceKind::Namespaces => match value.pointer("/status/phase").and_then(Value::as_str) {
            Some("Active") => "Active",
            Some("Terminating") => "Terminating",
            _ => "Unknown",
        }
        .into(),
        ResourceKind::Pods => pod_status(&value, &mut columns),
        ResourceKind::Deployments
        | ResourceKind::DaemonSets
        | ResourceKind::StatefulSets
        | ResourceKind::ReplicaSets => workload_status(&value, &mut columns),
        ResourceKind::Jobs | ResourceKind::CronJobs => job_status(&value, &mut columns),
        ResourceKind::Services => service_status(&value, &mut columns),
        ResourceKind::PersistentVolumeClaims => pvc_status(&value, &mut columns),
        ResourceKind::Events => event_status(&value, &mut columns),
        ResourceKind::Roles
        | ResourceKind::ClusterRoles
        | ResourceKind::RoleBindings
        | ResourceKind::ClusterRoleBindings => rbac_status(&value, &mut columns),
        ResourceKind::Secrets
        | ResourceKind::ConfigMaps
        | ResourceKind::CustomResourceDefinitions => "Metadata only".into(),
        _ => generic_status(&value, &mut columns),
    };
    Ok(ResourceItem {
        name,
        namespace,
        created_at,
        status: bounded(&status),
        columns,
        node: if kind == ResourceKind::Nodes {
            Some(node_info(&value)?)
        } else {
            None
        },
    })
}

fn project_node(
    v: &Value,
    columns: &mut BTreeMap<String, String>,
) -> Result<String, ConnectionError> {
    let info = node_info(v)?;
    let roles = bounded(&info.roles.join(","));
    insert(columns, "roles", roles);
    if let Some(version) = &info.version {
        insert(columns, "version", version.clone());
    }
    if v.pointer("/spec/unschedulable").and_then(Value::as_bool) == Some(true) {
        insert(columns, "schedulable", "false".into());
    }
    Ok(match v
        .pointer("/status/conditions")
        .and_then(Value::as_array)
        .and_then(|cs| {
            cs.iter()
                .find(|c| c.get("type").and_then(Value::as_str) == Some("Ready"))
        })
        .and_then(|c| c.get("status"))
        .and_then(Value::as_str)
    {
        Some("True") => "Ready",
        Some("False") => "Not ready",
        _ => "Unknown",
    }
    .into())
}
fn node_info(v: &Value) -> Result<NodeInfo, ConnectionError> {
    let labels = v.pointer("/metadata/labels").and_then(Value::as_object);
    let mut roles = Vec::new();
    if let Some(labels) = labels {
        for k in labels.keys() {
            if let Some(role) = k
                .strip_prefix("node-role.kubernetes.io/")
                .or_else(|| k.strip_prefix("kubernetes.io/role/"))
                && role.len() <= 63
                && valid_name(role)
                && roles.len() < 10
            {
                roles.push(role.to_owned());
            }
        }
    }
    roles.sort();
    roles.dedup();
    let version = v
        .pointer("/status/nodeInfo/kubeletVersion")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let capacity = usage_from(v.pointer("/status/capacity"));
    let allocatable = usage_from(v.pointer("/status/allocatable"));
    Ok(NodeInfo {
        roles,
        version,
        cpu: Usage {
            used: None,
            allocatable: allocatable.0,
            capacity: capacity.0,
        },
        memory: Usage {
            used: None,
            allocatable: allocatable.1,
            capacity: capacity.1,
        },
        metrics_timestamp: None,
    })
}
fn usage_from(v: Option<&Value>) -> (Option<f64>, Option<f64>) {
    let Some(o) = v.and_then(Value::as_object) else {
        return (None, None);
    };
    (
        o.get("cpu")
            .and_then(|x| x.as_str())
            .and_then(parse_quantity),
        o.get("memory")
            .and_then(|x| x.as_str())
            .and_then(parse_quantity),
    )
}
fn generic_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    if let Some(p) = v.pointer("/status/phase").and_then(Value::as_str) {
        insert(c, "phase", bounded(p));
        return bounded(p);
    }
    "Unknown".into()
}
fn pod_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    let cs = v
        .pointer("/status/containerStatuses")
        .and_then(Value::as_array);
    let (ready, restarts) = (
        cs.map(|x| {
            x.iter()
                .filter(|c| c.get("ready").and_then(Value::as_bool) == Some(true))
                .count()
        })
        .unwrap_or(0),
        cs.map(|x| {
            x.iter()
                .map(|c| c.get("restartCount").and_then(Value::as_u64).unwrap_or(0))
                .fold(0u64, u64::saturating_add)
        })
        .unwrap_or(0),
    );
    insert(c, "ready", format!("{ready}/{}", cs.map_or(0, Vec::len)));
    insert(c, "restarts", restarts.to_string());
    if let Some(n) = v.pointer("/spec/nodeName").and_then(Value::as_str) {
        insert(c, "node", bounded(n));
    }
    if let Some(q) = v.pointer("/status/qosClass").and_then(Value::as_str) {
        insert(c, "qos", bounded(q));
    }
    v.pointer("/status/phase")
        .and_then(Value::as_str)
        .map_or_else(|| "Unknown".into(), bounded)
}
fn workload_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    for (key, path) in [
        ("ready", "/status/readyReplicas"),
        ("updated", "/status/updatedReplicas"),
        ("available", "/status/availableReplicas"),
    ] {
        if let Some(n) = v.pointer(path).and_then(Value::as_u64) {
            insert(c, key, n.to_string());
        }
    }
    for (key, path) in [
        ("desired", "/status/desiredNumberScheduled"),
        ("scheduled", "/status/currentNumberScheduled"),
        ("ready", "/status/numberReady"),
    ] {
        if let Some(n) = v.pointer(path).and_then(Value::as_u64) {
            insert(c, key, n.to_string());
        }
    }
    v.pointer("/status/conditions")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .find(|x| x.get("type").and_then(Value::as_str) == Some("Available"))
        })
        .and_then(|x| x.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown")
        .into()
}
fn job_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    for (k, p) in [
        ("completions", "/status/succeeded"),
        ("failed", "/status/failed"),
        ("active", "/status/active"),
    ] {
        if let Some(n) = v.pointer(p).and_then(Value::as_u64) {
            insert(c, k, n.to_string());
        }
    }
    "Unknown".into()
}
fn service_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    for (k, p) in [("type", "/spec/type"), ("clusterIP", "/spec/clusterIP")] {
        if let Some(x) = v.pointer(p).and_then(Value::as_str) {
            insert(c, k, bounded(x));
        }
    }
    if let Some(ports) = v.pointer("/spec/ports").and_then(Value::as_array) {
        insert(
            c,
            "ports",
            ports
                .iter()
                .filter_map(|x| x.get("port").and_then(Value::as_u64))
                .take(12)
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    "Unknown".into()
}
fn pvc_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    if let Some(x) = v
        .pointer("/status/capacity/storage")
        .and_then(Value::as_str)
    {
        insert(c, "capacity", bounded(x));
    }
    if let Some(x) = v.pointer("/spec/storageClassName").and_then(Value::as_str) {
        insert(c, "storageClass", bounded(x));
    }
    if let Some(a) = v.pointer("/spec/accessModes").and_then(Value::as_array) {
        insert(
            c,
            "accessModes",
            a.iter()
                .filter_map(Value::as_str)
                .take(12)
                .map(bounded)
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    v.pointer("/status/phase")
        .and_then(Value::as_str)
        .unwrap_or("Unknown")
        .into()
}
fn event_status(v: &Value, c: &mut BTreeMap<String, String>) -> String {
    for (k, p) in [("type", "/type"), ("reason", "/reason")] {
        if let Some(x) = v.pointer(p).and_then(Value::as_str) {
            insert(c, k, bounded(x));
        }
    }
    if let Some(count) = v
        .pointer("/count")
        .or_else(|| v.pointer("/series/count"))
        .and_then(Value::as_u64)
    {
        insert(c, "count", count.to_string());
    }
    if let (Some(kind), Some(name)) = (
        v.pointer("/involvedObject/kind").and_then(Value::as_str),
        v.pointer("/involvedObject/name").and_then(Value::as_str),
    ) && valid_name(name)
    {
        insert(c, "involvedObject", bounded(&format!("{kind}/{name}")));
    }
    v.pointer("/type")
        .and_then(Value::as_str)
        .unwrap_or("Unknown")
        .into()
}
fn insert(c: &mut BTreeMap<String, String>, k: &str, v: String) {
    if c.len() < 12 && v.len() <= 256 {
        c.insert(k.into(), v);
    }
}
fn bounded(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars().filter(|c| !c.is_control()) {
        if out.len() + c.len_utf8() > 256 {
            break;
        }
        out.push(c);
    }
    out
}
pub(super) fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.split('.').all(|label| {
            !label.is_empty()
                && label.as_bytes()[0].is_ascii_alphanumeric()
                && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}
pub(super) fn timestamp(s: &str) -> Option<String> {
    (s.len() <= 64 && s.parse::<jiff::Timestamp>().is_ok()).then(|| s.to_owned())
}
pub(super) fn parse_quantity(s: &str) -> Option<f64> {
    if s.is_empty() || s.len() > 128 || s.starts_with('-') || s.chars().any(char::is_whitespace) {
        return None;
    }
    let mut number = s;
    let mut multiplier = 1.0;
    for (suffix, power, binary) in [
        ("Ki", 1, true),
        ("Mi", 2, true),
        ("Gi", 3, true),
        ("Ti", 4, true),
        ("Pi", 5, true),
        ("Ei", 6, true),
        ("n", -9, false),
        ("u", -6, false),
        ("m", -3, false),
        ("k", 3, false),
        ("M", 6, false),
        ("G", 9, false),
        ("T", 12, false),
        ("P", 15, false),
        ("E", 18, false),
    ] {
        if let Some(n) = s.strip_suffix(suffix) {
            number = n;
            multiplier = if binary {
                1024f64.powi(power)
            } else {
                10f64.powi(power)
            };
            break;
        }
    }
    // Kubernetes quantities permit decimal exponents, not NaN, infinity or mixed suffixes.
    let digits = number.strip_prefix('+').unwrap_or(number);
    let mut parts = digits.split(['e', 'E']);
    let mantissa = parts.next()?;
    let exponent = parts.next();
    if parts.next().is_some()
        || mantissa.is_empty()
        || !mantissa.bytes().any(|b| b.is_ascii_digit())
        || mantissa.bytes().any(|b| !b.is_ascii_digit() && b != b'.')
        || mantissa.bytes().filter(|b| *b == b'.').count() > 1
    {
        return None;
    }
    if let Some(e) = exponent {
        if multiplier != 1.0 {
            return None;
        }
        let e = e.strip_prefix(['+', '-']).unwrap_or(e);
        if e.is_empty() || !e.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
    }
    let value = number.parse::<f64>().ok()? * multiplier;
    (value.is_finite() && value >= 0.0 && value <= i64::MAX as f64).then_some(value)
}
