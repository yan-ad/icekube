use super::*;
use crate::connection::{
    OpenRequest,
    tests::{connected, fake, fixture},
};
use serde_json::json;

fn request(kind: ResourceKind) -> DetailRequest {
    DetailRequest {
        cluster_id: "cluster".into(),
        session_id: "session".into(),
        read_id: 1,
        reference: ResourceReference {
            kind,
            namespace: super::super::resources::namespaced(kind).then(|| "default".into()),
            name: "sample".into(),
            uid: Some("uid-1".into()),
        },
    }
}
fn object(r: &DetailRequest) -> Value {
    let (api, kind) = object_type(r.reference.kind);
    let mut value = json!({"apiVersion":api,"kind":kind,"metadata":{"name":"sample","uid":"uid-1","resourceVersion":"7"}});
    if let Some(ns) = &r.reference.namespace {
        value["metadata"]["namespace"] = json!(ns);
    }
    value
}
#[test]
fn exact_paths_and_closed_scope_validation() {
    let mut r = request(ResourceKind::Pods);
    assert_eq!(
        named_path(&r.reference).unwrap(),
        "/api/v1/namespaces/default/pods/sample"
    );
    r.reference.namespace = None;
    assert_eq!(validate(&r), Err(ConnectionError::InvalidInput));
    r = request(ResourceKind::Nodes);
    assert_eq!(named_path(&r.reference).unwrap(), "/api/v1/nodes/sample");
    r.reference.namespace = Some("default".into());
    assert!(validate(&r).is_err());
    for bad in ["../x", "a/b", "x?y", "a%2fb", "UPPER", "", "a\n"] {
        r = request(ResourceKind::Pods);
        r.reference.name = bad.into();
        assert!(validate(&r).is_err());
    }
    for bad in ["", "space uid", "a\n", "é"] {
        r = request(ResourceKind::Pods);
        r.reference.uid = Some(bad.into());
        assert!(validate(&r).is_err());
    }
    assert!(serde_json::from_value::<DetailRequest>(json!({"clusterId":"c","sessionId":"s","readId":1,"reference":{"kind":"pods","namespace":"default","name":"x","url":"https://bad"}})).is_err());
}
#[test]
fn identity_and_response_type_are_verified_before_projection() {
    let r = request(ResourceKind::Pods);
    assert!(project(&r, object(&r)).is_ok());
    for (path, bad) in [
        ("/kind", json!("Secret")),
        ("/apiVersion", json!("apps/v1")),
        ("/metadata/name", json!("other")),
        ("/metadata/namespace", json!("other")),
        ("/metadata/uid", Value::Null),
    ] {
        let mut v = object(&r);
        *v.pointer_mut(path).unwrap() = bad;
        assert_eq!(project(&r, v), Err(ConnectionError::InvalidResponse));
    }
    let mut v = object(&r);
    v["metadata"]["uid"] = json!("replacement");
    assert_eq!(project(&r, v), Err(ConnectionError::Conflict));
}
#[test]
fn secret_and_configmap_contents_never_cross_projection() {
    for kind in [ResourceKind::Secrets, ResourceKind::ConfigMaps] {
        let r = request(kind);
        assert_eq!(
            project(&r, object(&r)),
            Err(ConnectionError::InvalidResponse)
        );
        let mut v = object(&r);
        v["apiVersion"] = json!("meta.k8s.io/v1");
        v["kind"] = json!("PartialObjectMetadata");
        v["data"] = json!({"password":"PRIVATE"});
        v["stringData"] = json!({"password":"PRIVATE"});
        v["metadata"]["annotations"] = json!({"password":"PRIVATE"});
        v["metadata"]["labels"] = json!({"password":"PRIVATE"});
        let result = project(&r, v).unwrap();
        assert!(result.item.columns.is_empty());
        assert!(!serde_json::to_string(&result).unwrap().contains("PRIVATE"));
    }
}
#[test]
fn related_references_preserve_scopes_and_allowlisted_types() {
    let r = request(ResourceKind::PersistentVolumes);
    let mut v = object(&r);
    v["spec"] = json!({"storageClassName":"fast","claimRef":{"name":"claim","namespace":"team","uid":"claim-uid"}});
    let d = project(&r, v).unwrap();
    assert_eq!(d.related["storageClass"].namespace, None);
    assert_eq!(d.related["claim"].namespace.as_deref(), Some("team"));
    assert_eq!(d.related["claim"].uid.as_deref(), Some("claim-uid"));
    let r = request(ResourceKind::RoleBindings);
    for (role, expected) in [
        ("Role", Some(ResourceKind::Roles)),
        ("ClusterRole", Some(ResourceKind::ClusterRoles)),
        ("Secret", None),
    ] {
        let mut v = object(&r);
        v["roleRef"] = json!({"apiGroup":"rbac.authorization.k8s.io","kind":role,"name":"reader"});
        let d = project(&r, v).unwrap();
        assert_eq!(d.related.get("roleRef").map(|r| r.kind), expected);
    }
    let r = request(ResourceKind::HorizontalPodAutoscalers);
    let mut v = object(&r);
    v["spec"] = json!({"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"web"}});
    assert_eq!(
        project(&r, v.clone()).unwrap().related["target"].kind,
        ResourceKind::Deployments
    );
    v["spec"]["scaleTargetRef"]["apiVersion"] = json!("evil/v1");
    assert!(!project(&r, v).unwrap().related.contains_key("target"));
}
#[test]
fn controlled_pod_owner_is_exact_and_safe() {
    let r = request(ResourceKind::Pods);
    let mut v = object(&r);
    v["spec"] = json!({"nodeName":"node-a"});
    v["metadata"]["ownerReferences"] = json!([{"apiVersion":"apps/v1","kind":"ReplicaSet","name":"web","uid":"owner-uid","controller":true,"private":"PRIVATE"}]);
    let d = project(&r, v.clone()).unwrap();
    assert_eq!(d.item.columns["controlledBy"], "web");
    assert_eq!(d.related["controlledBy"].uid.as_deref(), Some("owner-uid"));
    assert!(!serde_json::to_string(&d).unwrap().contains("PRIVATE"));
    v["metadata"]["ownerReferences"][0]["apiVersion"] = json!("evil/v1");
    assert!(!project(&r, v).unwrap().related.contains_key("controlledBy"));
}
struct Pending;
impl super::super::transport::ResourceTransport for Pending {
    async fn detail(
        &self,
        _: &kube::Client,
        _: &ResourceReference,
        _: &CancellationToken,
    ) -> Result<Value> {
        std::future::pending().await
    }
}
#[tokio::test]
async fn cancel_is_lease_scoped_and_independent_from_table_reads() {
    let (_root, _catalog, engine, id, _) = fixture();
    let opened = connected(
        &engine,
        id,
        fake(|_| {
            (
                200,
                serde_json::to_vec(&json!({"gitVersion":"v1.36.0"})).unwrap(),
            )
        }),
    )
    .await;
    let mut r = request(ResourceKind::Pods);
    r.cluster_id = opened.cluster_id.clone();
    r.session_id = opened.session_id.clone();
    let future = engine.resource_detail_with(r.clone(), &Pending);
    tokio::pin!(future);
    tokio::select! { _ = &mut future => panic!("pending"), _ = tokio::time::sleep(std::time::Duration::from_millis(5)) => {} }
    assert!(
        engine
            .session
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .reads
            .is_empty()
    );
    let mut wrong = r.clone();
    wrong.session_id = "old-session".into();
    engine.cancel_resource_detail(wrong).unwrap();
    assert!(
        !engine
            .session
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .detail
            .cancel
            .as_ref()
            .unwrap()
            .is_cancelled()
    );
    engine.cancel_resource_detail(r.clone()).unwrap();
    assert_eq!(future.await, Err(ConnectionError::StaleSession));
    assert_eq!(
        engine.resource_detail_with(r.clone(), &Pending).await,
        Err(ConnectionError::StaleSession)
    );
    r.read_id = 2;
    engine.cancel_resource_detail(r.clone()).unwrap();
    assert_eq!(
        engine.resource_detail_with(r, &Pending).await,
        Err(ConnectionError::StaleSession)
    );
    let _ = engine
        .open(OpenRequest {
            cluster_id: opened.cluster_id,
        })
        .await
        .unwrap();
}
#[tokio::test]
async fn real_transport_uses_named_get_and_metadata_accept_on_fake_service() {
    use http::{Request, Response};
    use kube::client::Body;
    let (_root, _catalog, engine, id, _) = fixture();
    let client = kube::Client::new(
        tower::service_fn(|r: Request<Body>| async move {
            let body = if r.uri().path() == "/version" {
                json!({"gitVersion":"v1.36.0"})
            } else {
                assert_eq!(r.method(), http::Method::GET);
                assert_eq!(
                    r.uri().to_string(),
                    "/api/v1/namespaces/default/secrets/sample"
                );
                assert_eq!(
                    r.headers()["accept"],
                    "application/json;as=PartialObjectMetadata;g=meta.k8s.io;v=v1"
                );
                json!({"apiVersion":"meta.k8s.io/v1","kind":"PartialObjectMetadata","metadata":{"name":"sample","namespace":"default","uid":"uid-1"}})
            };
            Ok::<_, std::io::Error>(Response::new(Body::from(
                serde_json::to_vec(&body).unwrap(),
            )))
        }),
        "default",
    );
    let opened = connected(&engine, id, client).await;
    let mut r = request(ResourceKind::Secrets);
    r.cluster_id = opened.cluster_id;
    r.session_id = opened.session_id;
    assert!(engine.resource_detail(r).await.is_ok());
}

#[test]
fn every_allowlisted_kind_has_consistent_named_endpoint_and_safe_projection() {
    let source = include_str!("../../connection.rs");
    let block = source
        .split("pub enum ResourceKind {")
        .nth(1)
        .unwrap()
        .split('}')
        .next()
        .unwrap();
    for variant in block
        .lines()
        .map(str::trim)
        .map(|s| s.trim_end_matches(','))
        .filter(|s| !s.is_empty())
    {
        let wire = format!("{}{}", variant[..1].to_lowercase(), &variant[1..]);
        let kind: ResourceKind = serde_json::from_value(json!(wire)).unwrap();
        let r = request(kind);
        let (api, _) = object_type(kind);
        let (prefix, plural) = super::super::transport::endpoint(kind);
        assert_eq!(
            prefix,
            if api == "v1" {
                "/api/v1".to_owned()
            } else {
                format!("/apis/{api}")
            }
        );
        let path = named_path(&r.reference).unwrap();
        assert!(path.ends_with(&format!("/{plural}/sample")));
        let mut v = object(&r);
        if matches!(kind, ResourceKind::Secrets | ResourceKind::ConfigMaps) {
            v["apiVersion"] = json!("meta.k8s.io/v1");
            v["kind"] = json!("PartialObjectMetadata");
        }
        v["metadata"]["annotations"] = json!({"secret":"PRIVATE"});
        v["metadata"]["labels"] = json!({"secret":"PRIVATE"});
        let d = project(&r, v).unwrap();
        assert_eq!(d.item.uid.as_deref(), Some("uid-1"));
        assert!(!serde_json::to_string(&d).unwrap().contains("PRIVATE"));
    }
}

#[tokio::test]
async fn deadline_and_drop_release_workers_and_new_reads_survive_old_disposal() {
    let (_root, _catalog, engine, id, _) = fixture();
    let opened = connected(
        &engine,
        id,
        fake(|_| {
            (
                200,
                serde_json::to_vec(&json!({"gitVersion":"v1.36.0"})).unwrap(),
            )
        }),
    )
    .await;
    let mut r = request(ResourceKind::Pods);
    r.cluster_id = opened.cluster_id;
    r.session_id = opened.session_id;
    tokio::time::pause();
    assert_eq!(
        engine.resource_detail_with(r.clone(), &Pending).await,
        Err(ConnectionError::Timeout)
    );
    assert_eq!(engine.workers.available_permits(), 4);
    r.read_id = 2;
    let mut old = Box::pin(engine.resource_detail_with(r.clone(), &Pending));
    tokio::select! { _ = &mut old => panic!("pending"), _ = tokio::task::yield_now() => {} }
    let token = engine
        .session
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .detail
        .cancel
        .clone()
        .unwrap();
    drop(old);
    assert!(token.is_cancelled());
    assert_eq!(engine.workers.available_permits(), 4);
    r.read_id = 3;
    let mut new = Box::pin(engine.resource_detail_with(r.clone(), &Pending));
    tokio::select! { _ = &mut new => panic!("pending"), _ = tokio::task::yield_now() => {} }
    let mut old_cancel = r.clone();
    old_cancel.read_id = 2;
    engine.cancel_resource_detail(old_cancel).unwrap();
    assert!(
        !engine
            .session
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .detail
            .cancel
            .as_ref()
            .unwrap()
            .is_cancelled()
    );
    engine.disconnect(r.session()).unwrap();
    assert_eq!(new.await, Err(ConnectionError::StaleSession));
}

#[tokio::test]
async fn missing_resource_is_not_an_empty_success_and_server_text_is_discarded() {
    let (_root, _catalog, engine, id, _) = fixture();
    let opened = connected(
        &engine,
        id,
        fake(|path| {
            if path == "/version" {
                (
                    200,
                    serde_json::to_vec(&json!({"gitVersion":"v1.36.0"})).unwrap(),
                )
            } else {
                (404, b"PRIVATE server body".to_vec())
            }
        }),
    )
    .await;
    let mut r = request(ResourceKind::Pods);
    r.cluster_id = opened.cluster_id;
    r.session_id = opened.session_id;
    assert_eq!(
        engine.resource_detail(r).await,
        Err(ConnectionError::ResourceUnavailable)
    );
}

#[test]
fn event_relations_require_exact_type_scope_and_uid() {
    let r = request(ResourceKind::Events);
    let target =
        json!({"apiVersion":"v1","kind":"Pod","name":"web","namespace":"default","uid":"pod-uid"});
    let mut v = object(&r);
    v["involvedObject"] = target.clone();
    let d = project(&r, v.clone()).unwrap();
    assert_eq!(d.item.namespace.as_deref(), Some("default"));
    assert_eq!(d.item.columns["involvedObject"], "Pod/web");
    assert_eq!(d.related["involvedObject"].uid.as_deref(), Some("pod-uid"));
    assert_eq!(
        named_path(&d.related["involvedObject"]).unwrap(),
        "/api/v1/namespaces/default/pods/web"
    );
    for (field, bad) in [
        ("namespace", json!("other")),
        ("namespace", Value::Null),
        ("apiVersion", json!("apps/v1")),
        ("apiVersion", json!("unknown/v1")),
        ("kind", json!("Unknown")),
        ("uid", Value::Null),
        ("uid", json!("bad uid")),
        ("name", json!("../bad")),
    ] {
        let mut bad_value = v.clone();
        bad_value["involvedObject"][field] = bad;
        assert!(
            !project(&r, bad_value)
                .unwrap()
                .related
                .contains_key("involvedObject")
        );
    }
    let mut regarding = object(&r);
    regarding["regarding"] = target.clone();
    assert!(
        project(&r, regarding.clone())
            .unwrap()
            .related
            .contains_key("involvedObject")
    );
    regarding["involvedObject"] = target;
    assert!(
        project(&r, regarding.clone())
            .unwrap()
            .related
            .contains_key("involvedObject")
    );
    regarding["regarding"]["uid"] = json!("other-uid");
    assert!(
        !project(&r, regarding)
            .unwrap()
            .related
            .contains_key("involvedObject")
    );
    v["involvedObject"] = json!({"apiVersion":"v1","kind":"Node","name":"node-a","uid":"node-uid"});
    let d = project(&r, v.clone()).unwrap();
    assert_eq!(d.related["involvedObject"].namespace, None);
    assert_eq!(d.item.namespace.as_deref(), Some("default"));
    v["involvedObject"]["namespace"] = json!("default");
    assert!(
        !project(&r, v)
            .unwrap()
            .related
            .contains_key("involvedObject")
    );
}

#[test]
fn ingress_and_pod_explicit_relations_do_not_infer_defaults_or_annotations() {
    let r = request(ResourceKind::Ingresses);
    let mut v = object(&r);
    v["metadata"]["annotations"] = json!({"kubernetes.io/ingress.class":"legacy"});
    assert!(
        !project(&r, v.clone())
            .unwrap()
            .related
            .contains_key("class")
    );
    v["spec"] = json!({"ingressClassName":"nginx"});
    let d = project(&r, v).unwrap();
    assert_eq!(d.related["class"].kind, ResourceKind::IngressClasses);
    assert_eq!(d.related["class"].namespace, None);
    let r = request(ResourceKind::Pods);
    let mut v = object(&r);
    assert!(
        !project(&r, v.clone())
            .unwrap()
            .related
            .contains_key("serviceAccount")
    );
    v["spec"] = json!({"serviceAccountName":"runner"});
    let d = project(&r, v).unwrap();
    assert_eq!(d.item.columns["serviceAccount"], "runner");
    assert_eq!(
        d.related["serviceAccount"].namespace.as_deref(),
        Some("default")
    );
}

#[test]
fn workload_controllers_preserve_exact_namespaced_identity() {
    for (child, api, kind, owner_kind) in [
        (
            ResourceKind::ReplicaSets,
            "apps/v1",
            "Deployment",
            ResourceKind::Deployments,
        ),
        (
            ResourceKind::Jobs,
            "batch/v1",
            "CronJob",
            ResourceKind::CronJobs,
        ),
    ] {
        let r = request(child);
        let mut v = object(&r);
        v["metadata"]["ownerReferences"] = json!([{"apiVersion":api,"kind":kind,"name":"owner","uid":"owner-uid","controller":true}]);
        let d = project(&r, v.clone()).unwrap();
        assert_eq!(d.related["controlledBy"].kind, owner_kind);
        assert_eq!(
            d.related["controlledBy"].namespace.as_deref(),
            Some("default")
        );
        assert_eq!(d.item.columns["controlledBy"], "owner");
        v["metadata"]["ownerReferences"][0]["namespace"] = json!("other");
        assert!(
            !project(&r, v.clone())
                .unwrap()
                .related
                .contains_key("controlledBy")
        );
        v["metadata"]["ownerReferences"][0]["namespace"] = json!("default");
        v["metadata"]["ownerReferences"][0]["apiVersion"] = json!("wrong/v1");
        assert!(
            !project(&r, v.clone())
                .unwrap()
                .related
                .contains_key("controlledBy")
        );
        v["metadata"]["ownerReferences"][0]["apiVersion"] = json!(api);
        let duplicate = v["metadata"]["ownerReferences"][0].clone();
        v["metadata"]["ownerReferences"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(!project(&r, v).unwrap().related.contains_key("controlledBy"));
    }
}
