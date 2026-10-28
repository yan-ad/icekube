use super::*;
use crate::connection::tests::{fixture, identity};
use http::{Request, Response};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};

#[tokio::test(start_paused = true)]
async fn review_timeout_and_cancel_drop_pending_transport() {
    let pending = Client::new(
        tower::service_fn(|_: Request<Body>| async {
            std::future::pending::<std::result::Result<Response<Body>, std::io::Error>>().await
        }),
        "default",
    );
    let check = PermissionCheck {
        kind: ResourceKind::Nodes,
        action: PermissionAction::List,
        namespace: None,
        name: None,
    };
    let started = tokio::time::Instant::now();
    let item = review_check(&pending, &check, &CancellationToken::new()).await;
    assert_eq!(item.decision, PermissionDecision::Unknown);
    assert!(started.elapsed() <= Duration::from_secs(5));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        review_check(&pending, &check, &cancel).await.reason,
        Some(PermissionReason::Unavailable)
    );
}

#[tokio::test(start_paused = true)]
async fn monotonic_expiry_rejects_a_cached_deny_after_ttl() {
    let (_root, _catalog, engine, id, _) = fixture();
    let snapshot = engine
        .open(crate::connection::OpenRequest { cluster_id: id })
        .await
        .unwrap();
    let identity = identity(&snapshot);
    let check = PermissionCheck {
        kind: ResourceKind::Nodes,
        action: PermissionAction::List,
        namespace: None,
        name: None,
    };
    {
        let mut state = engine.session.lock().unwrap();
        let permissions = &mut state.as_mut().unwrap().permissions;
        permissions.synchronize(&engine.authentication_generation);
        permissions.cache.insert(
            check.clone(),
            Cached {
                item: PermissionItem {
                    check: check.clone(),
                    decision: PermissionDecision::Denied,
                    reason: Some(PermissionReason::Denied),
                },
                expires: now() + 60_000,
                deadline: tokio::time::Instant::now() + Duration::from_secs(10),
                used: 1,
            },
        );
    }
    assert_eq!(
        engine.reject_known_denied_read(&identity, &check),
        Err(ConnectionError::PermissionDenied)
    );
    tokio::time::advance(Duration::from_secs(11)).await;
    assert_eq!(engine.reject_known_denied_read(&identity, &check), Ok(()));
}

#[tokio::test]
async fn replaced_batch_does_not_publish_late_permission() {
    let (_root, _catalog, engine, id, _) = fixture();
    let seen = Arc::new(AtomicUsize::new(0));
    let count = seen.clone();
    let client = Client::new(
        tower::service_fn(move |request: Request<Body>| {
            let count = count.clone();
            async move {
                if request.uri().path() == "/version" {
                    return Ok::<_, std::io::Error>(Response::new(Body::from(
                        serde_json::to_vec(&json!({"gitVersion":"v1.36.0"})).unwrap(),
                    )));
                }
                count.fetch_add(1, Ordering::SeqCst);
                std::future::pending::<std::result::Result<Response<Body>, std::io::Error>>().await
            }
        }),
        "default",
    );
    let snapshot = crate::connection::tests::connected(&engine, id, client).await;
    let identity = identity(&snapshot);
    let request = ReviewRequest {
        cluster_id: identity.cluster_id,
        session_id: identity.session_id,
        read_id: 1,
        checks: vec![PermissionCheck {
            kind: ResourceKind::Nodes,
            action: PermissionAction::List,
            namespace: None,
            name: None,
        }],
    };
    let review = engine.review_permissions(request.clone());
    let cancel = async {
        while seen.load(Ordering::SeqCst) == 0 {
            tokio::task::yield_now().await;
        }
        let mut newer = request.clone();
        newer.read_id = 2;
        engine.cancel_permissions(newer).unwrap();
    };
    let (result, _) = tokio::join!(review, cancel);
    assert!(matches!(result, Err(ConnectionError::StaleSession)));
    let state = engine.session.lock().unwrap();
    assert!(state.as_ref().unwrap().permissions.cache.is_empty());
}

#[test]
fn epoch_change_clears_cache() {
    let generation = Arc::new(AtomicU64::new(1));
    let mut scope = PermissionSession::default();
    scope.synchronize(&generation);
    let check = PermissionCheck {
        kind: ResourceKind::Nodes,
        action: PermissionAction::List,
        namespace: None,
        name: None,
    };
    scope.cache.insert(
        check.clone(),
        Cached {
            item: unknown(&check, PermissionReason::Unavailable),
            expires: now() + 2_000,
            deadline: tokio::time::Instant::now() + Duration::from_secs(2),
            used: 1,
        },
    );
    invalidate_authentication(&generation);
    scope.synchronize(&generation);
    assert!(scope.cache.is_empty());
    let _ = Mutex::new(scope);
}
