use super::tests::{connected, fake, fixture, normal, resource};
use super::*;
use serde_json::json;

#[test]
fn fixed_endpoints_cover_every_resource_kind_and_wire_spelling() {
    let kinds = [
        (ResourceKind::Nodes, "nodes", "/api/v1/nodes"),
        (ResourceKind::Namespaces, "namespaces", "/api/v1/namespaces"),
        (ResourceKind::Pods, "pods", "/api/v1/pods"),
        (
            ResourceKind::Deployments,
            "deployments",
            "/apis/apps/v1/deployments",
        ),
        (
            ResourceKind::DaemonSets,
            "daemonSets",
            "/apis/apps/v1/daemonsets",
        ),
        (
            ResourceKind::StatefulSets,
            "statefulSets",
            "/apis/apps/v1/statefulsets",
        ),
        (
            ResourceKind::ReplicaSets,
            "replicaSets",
            "/apis/apps/v1/replicasets",
        ),
        (ResourceKind::Jobs, "jobs", "/apis/batch/v1/jobs"),
        (
            ResourceKind::CronJobs,
            "cronJobs",
            "/apis/batch/v1/cronjobs",
        ),
        (ResourceKind::ConfigMaps, "configMaps", "/api/v1/configmaps"),
        (ResourceKind::Secrets, "secrets", "/api/v1/secrets"),
        (
            ResourceKind::ResourceQuotas,
            "resourceQuotas",
            "/api/v1/resourcequotas",
        ),
        (
            ResourceKind::LimitRanges,
            "limitRanges",
            "/api/v1/limitranges",
        ),
        (
            ResourceKind::HorizontalPodAutoscalers,
            "horizontalPodAutoscalers",
            "/apis/autoscaling/v2/horizontalpodautoscalers",
        ),
        (
            ResourceKind::PodDisruptionBudgets,
            "podDisruptionBudgets",
            "/apis/policy/v1/poddisruptionbudgets",
        ),
        (
            ResourceKind::PriorityClasses,
            "priorityClasses",
            "/apis/scheduling.k8s.io/v1/priorityclasses",
        ),
        (
            ResourceKind::RuntimeClasses,
            "runtimeClasses",
            "/apis/node.k8s.io/v1/runtimeclasses",
        ),
        (ResourceKind::Services, "services", "/api/v1/services"),
        (ResourceKind::Endpoints, "endpoints", "/api/v1/endpoints"),
        (
            ResourceKind::Ingresses,
            "ingresses",
            "/apis/networking.k8s.io/v1/ingresses",
        ),
        (
            ResourceKind::IngressClasses,
            "ingressClasses",
            "/apis/networking.k8s.io/v1/ingressclasses",
        ),
        (
            ResourceKind::NetworkPolicies,
            "networkPolicies",
            "/apis/networking.k8s.io/v1/networkpolicies",
        ),
        (
            ResourceKind::PersistentVolumes,
            "persistentVolumes",
            "/api/v1/persistentvolumes",
        ),
        (
            ResourceKind::PersistentVolumeClaims,
            "persistentVolumeClaims",
            "/api/v1/persistentvolumeclaims",
        ),
        (
            ResourceKind::StorageClasses,
            "storageClasses",
            "/apis/storage.k8s.io/v1/storageclasses",
        ),
        (ResourceKind::Events, "events", "/api/v1/events"),
        (
            ResourceKind::ServiceAccounts,
            "serviceAccounts",
            "/api/v1/serviceaccounts",
        ),
        (
            ResourceKind::Roles,
            "roles",
            "/apis/rbac.authorization.k8s.io/v1/roles",
        ),
        (
            ResourceKind::RoleBindings,
            "roleBindings",
            "/apis/rbac.authorization.k8s.io/v1/rolebindings",
        ),
        (
            ResourceKind::ClusterRoles,
            "clusterRoles",
            "/apis/rbac.authorization.k8s.io/v1/clusterroles",
        ),
        (
            ResourceKind::ClusterRoleBindings,
            "clusterRoleBindings",
            "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings",
        ),
        (
            ResourceKind::CustomResourceDefinitions,
            "customResourceDefinitions",
            "/apis/apiextensions.k8s.io/v1/customresourcedefinitions",
        ),
    ];
    for (kind, wire, path) in kinds {
        assert_eq!(serde_json::to_value(kind).unwrap(), wire);
        let mut request = request(kind);
        assert_eq!(
            transport::resource_path(&request),
            format!("{path}?limit=100&timeoutSeconds=10")
        );
        request.namespace = Some("team-a".into());
        assert_eq!(
            transport::validate_resource_request(&request).is_ok(),
            resources::namespaced(kind)
        );
    }
}
fn request(kind: ResourceKind) -> ResourceRequest {
    ResourceRequest {
        cluster_id: "fixture".into(),
        session_id: "lease".into(),
        kind,
        read_id: 1,
        namespace: None,
        continue_token: None,
    }
}
#[test]
fn namespace_and_continuation_are_validated_and_encoded() {
    let mut r = request(ResourceKind::Pods);
    for ns in [
        "",
        "../secrets",
        "a/b",
        "a?x=y",
        "A",
        "-a",
        "a-",
        "a.b",
        "a\n",
    ] {
        r.namespace = Some(ns.into());
        assert_eq!(
            transport::validate_resource_request(&r),
            Err(ConnectionError::InvalidInput)
        );
    }
    r.namespace = Some("team-a".into());
    r.continue_token = Some("a+/=?&x#é".into());
    assert!(transport::validate_resource_request(&r).is_ok());
    assert_eq!(
        transport::resource_path(&r),
        "/api/v1/namespaces/team-a/pods?limit=100&timeoutSeconds=10&continue=a%2B%2F%3D%3F%26x%23%C3%A9"
    );
    for token in ["x".repeat(4097), "x\n".into()] {
        r.continue_token = Some(token);
        assert!(transport::validate_resource_request(&r).is_err());
    }
    assert!(
        serde_json::from_value::<ResourceRequest>(
            json!({"clusterId":"x","sessionId":"y","readId":1,"kind":"pods","url":"https://bad"})
        )
        .is_err()
    );
}
#[test]
fn quantities_are_cores_and_bytes_with_binary_decimal_and_exponents() {
    for (s, n) in [
        ("250m", 0.25),
        ("123456789n", 0.123456789),
        ("10u", 0.00001),
        ("2Gi", 2147483648.0),
        ("1.5Mi", 1572864.0),
        ("2G", 2e9),
        ("1e3", 1000.0),
        ("1E-3", 0.001),
        ("1Ei", 1152921504606846976.0),
    ] {
        assert!((resources::parse_quantity(s).unwrap() - n).abs() <= n * 1e-12);
    }
    for s in [
        "-1", "NaN", "inf", "1e400", "1e3m", "1.2.3", "1K", "1 Mi", "1e", "1e-", "1GiB", "100Ei",
    ] {
        assert_eq!(resources::parse_quantity(s), None, "{s}");
    }
}
#[tokio::test]
async fn metadata_only_negotiation_and_namespace_identity() {
    use http::{Request, Response};
    use kube::client::Body;
    let client = Client::new(
        transport::CancelService(tower::service_fn(|r: Request<Body>| async move {
            assert_eq!(
                r.headers()["accept"],
                "application/json;as=PartialObjectMetadataList;g=meta.k8s.io;v=v1"
            );
            Ok::<_,std::io::Error>(Response::new(Body::from(json!({"kind":"PartialObjectMetadataList","items":[
            {"metadata":{"name":"same","namespace":"a","annotations":{"key":"PRIVATE"}},"data":{"password":"PRIVATE"}},
            {"metadata":{"name":"same","namespace":"b"}}
        ]}).to_string().into_bytes())))
        })),
        "default",
    );
    for kind in [ResourceKind::Secrets, ResourceKind::ConfigMaps] {
        let page = transport::resources(&client, &request(kind), &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(page.items.len(), 2);
        assert!(!serde_json::to_string(&page).unwrap().contains("PRIVATE"));
    }
    let raw = fake(|_| (200, json!({"items":[]}).to_string().into_bytes()));
    assert_eq!(
        transport::resources(
            &raw,
            &request(ResourceKind::Secrets),
            &CancellationToken::new()
        )
        .await,
        Err(ConnectionError::InvalidResponse)
    );
}
fn node() -> serde_json::Value {
    json!({"metadata":{"name":"node-a","labels":{"node-role.kubernetes.io/control-plane":"","arbitrary":"PRIVATE"}},"status":{"nodeInfo":{"kubeletVersion":"v1.36.0"},"capacity":{"cpu":"2","memory":"2Gi"},"allocatable":{"cpu":"1500m","memory":"1Gi"},"conditions":[{"type":"Ready","status":"True"}]},"spec":{"unschedulable":true}})
}
#[tokio::test]
async fn node_metrics_states_preserve_inventory_and_never_invent_disk() {
    for (status, body, expected) in [
        (404, json!({}), MetricState::Unavailable),
        (403, json!({}), MetricState::Denied),
        (401, json!({}), MetricState::Denied),
        (500, json!({}), MetricState::Error),
        (200, json!({"items":[]}), MetricState::Partial),
        (
            200,
            json!({"items":[{"metadata":{"name":"node-a"},"timestamp":"2000-01-01T00:00:00Z","usage":{"cpu":"10m","memory":"1Ki"}}]}),
            MetricState::Stale,
        ),
        (
            200,
            json!({"items":[{"metadata":{"name":"node-a"},"timestamp":"invalid","usage":{"cpu":"10m","memory":"1Ki"}}]}),
            MetricState::Partial,
        ),
        (
            200,
            json!({"items":[{"metadata":{"name":"node-a"},"timestamp":jiff::Timestamp::now().to_string(),"usage":{"cpu":"3000000000n","memory":"3Gi"}}]}),
            MetricState::Available,
        ),
    ] {
        let client = fake(move |path| {
            if path.starts_with("/apis/metrics") {
                (status, body.to_string().into_bytes())
            } else {
                (200, json!({"items":[node()]}).to_string().into_bytes())
            }
        });
        let page = transport::resources(
            &client,
            &request(ResourceKind::Nodes),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(page.metrics, Some(expected));
        assert_eq!(page.items[0].status, "Ready");
        let n = page.items[0].node.as_ref().unwrap();
        assert_eq!(n.cpu.allocatable, Some(1.5));
        assert_eq!(n.memory.capacity, Some(2147483648.0));
        assert_eq!(n.roles, ["control-plane"]);
        assert_eq!(
            n.cpu.used,
            if expected == MetricState::Available {
                Some(3.0)
            } else {
                None
            }
        );
        assert_eq!(n.disk_allocatable, None);
        let wire = serde_json::to_value(n).unwrap();
        assert!(wire["diskAllocatable"].is_null());
        assert!(wire.get("disk").is_none());
    }
}
#[tokio::test(start_paused = true)]
async fn metrics_timeout_is_optional_but_cancellation_discards_late_metrics() {
    use http::{Request, Response};
    use kube::client::Body;
    let started = Arc::new(tokio::sync::Notify::new());
    let marker = started.clone();
    let client = Client::new(
        transport::CancelService(tower::service_fn(move |r: Request<Body>| {
            let marker = marker.clone();
            async move {
                if r.uri().path().starts_with("/apis/metrics") {
                    marker.notify_one();
                    return std::future::pending().await;
                }
                let bytes = if r.uri().path() == "/version" {
                    normal("/version").1
                } else {
                    json!({"items":[node()]}).to_string().into_bytes()
                };
                Ok::<_, std::io::Error>(Response::new(Body::from(bytes)))
            }
        })),
        "default",
    );
    let (_root, _catalog, engine, id, _) = fixture();
    let s = connected(&engine, id, client).await;
    let r = resource(&s, ResourceKind::Nodes);
    let (result, ()) = tokio::join!(engine.resources(r.clone()), async {
        started.notified().await;
        engine.cancel_resources(r.clone()).unwrap();
    });
    assert_eq!(result, Err(ConnectionError::StaleSession));
    let mut r = r;
    r.read_id = 2;
    let page = engine.resources(r).await.unwrap();
    assert_eq!(page.metrics, Some(MetricState::Error));
    assert_eq!(page.items.len(), 1);
}
#[test]
fn representative_projection_has_only_bounded_allowed_scalars() {
    let metadata = json!({"name":"example","namespace":"team","creationTimestamp":"2026-01-01T00:00:00Z","annotations":{"password":"PRIVATE"}});
    for (kind, extra, key, expected) in [
        (
            ResourceKind::Pods,
            json!({"status":{"phase":"Running","qosClass":"Guaranteed","containerStatuses":[{"ready":true,"restartCount":2}]},"spec":{"nodeName":"worker","containers":[{"env":["PRIVATE"]}]}}),
            "ready",
            "1/1",
        ),
        (
            ResourceKind::Deployments,
            json!({"status":{"readyReplicas":3,"updatedReplicas":2,"availableReplicas":3}}),
            "updated",
            "2",
        ),
        (
            ResourceKind::Services,
            json!({"spec":{"type":"ClusterIP","clusterIP":"10.0.0.1","ports":[{"port":443}]}}),
            "ports",
            "443",
        ),
        (
            ResourceKind::PersistentVolumeClaims,
            json!({"spec":{"storageClassName":"fast","accessModes":["ReadWriteOnce"]},"status":{"phase":"Bound","capacity":{"storage":"5Gi"}}}),
            "capacity",
            "5Gi",
        ),
        (
            ResourceKind::RoleBindings,
            json!({"roleRef":{"name":"reader"},"subjects":[{"name":"PRIVATE"}]}),
            "subjects",
            "1",
        ),
        (
            ResourceKind::Events,
            json!({"type":"Warning","reason":"Failed","count":3,"message":"PRIVATE","involvedObject":{"kind":"Pod","name":"example"}}),
            "count",
            "3",
        ),
    ] {
        let mut v = extra;
        v["metadata"] = metadata.clone();
        let row = resources::project(kind, v).unwrap();
        assert_eq!(row.columns[key], expected);
        assert!(row.columns.len() <= 12);
        assert!(row.columns.values().all(|v| v.len() <= 256));
        assert!(!serde_json::to_string(&row).unwrap().contains("PRIVATE"));
    }
}
#[tokio::test]
async fn bad_continuation_missing_namespace_and_resource_404_fail_closed() {
    for (status, body, error) in [
        (404, json!({}), ConnectionError::ResourceUnavailable),
        (
            200,
            json!({"items":[{"metadata":{"name":"example"}}]}),
            ConnectionError::InvalidResponse,
        ),
        (
            200,
            json!({"items":[],"metadata":{"continue":"x\n"}}),
            ConnectionError::InvalidResponse,
        ),
    ] {
        let client = fake(move |_| (status, body.to_string().into_bytes()));
        assert_eq!(
            transport::resources(
                &client,
                &request(ResourceKind::Pods),
                &CancellationToken::new()
            )
            .await,
            Err(error)
        );
    }
}
