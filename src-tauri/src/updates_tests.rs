use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
struct Fake {
    calls: AtomicUsize,
    delay: Duration,
    ready: bool,
}

#[test]
fn preparation_wire_contract_omits_inactive_attempt() {
    let engine = staged_engine();
    assert!(
        serde_json::to_value(engine.snapshot())
            .unwrap()
            .get("preparationId")
            .is_none()
    );
    engine.begin_preparation().unwrap();
    let value = serde_json::to_value(engine.snapshot()).unwrap();
    assert_eq!(value["phase"], "preparing");
    assert_eq!(value["preparationId"].as_str().unwrap().len(), 32);
    engine.shutdown();
    assert!(
        serde_json::to_value(engine.snapshot())
            .unwrap()
            .get("preparationId")
            .is_none()
    );
    assert!(engine.gate.admit("main").is_ok());
}

#[test]
fn backend_reservation_and_native_window_admission_share_one_gate() {
    let engine = staged_engine();
    admit(&engine, "main", 1);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    let entered = Arc::new(std::sync::Barrier::new(2));
    let release = Arc::new(std::sync::Barrier::new(2));
    let owner = engine.clone();
    let started = entered.clone();
    let finish = release.clone();
    let install = std::thread::spawn(move || {
        owner.take_ready(|| {
            started.wait();
            finish.wait();
            true
        })
    });
    entered.wait();
    let gate = engine.gate.clone();
    let admission = std::thread::spawn(move || gate.admit("iceon-1"));
    release.wait();
    drop(install.join().unwrap().unwrap());
    assert!(admission.join().unwrap().is_err());
    assert_eq!(engine.snapshot().phase, Phase::Restarting);
}

#[test]
fn every_window_must_acknowledge_before_backend_reservation() {
    let engine = staged_engine();
    admit(&engine, "main", 1);
    admit(&engine, "iceon-1", 2);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    engine.report_ready("iceon-1", 2, true);
    assert!(matches!(
        engine.take_ready(|| panic!("second window has not quiesced")),
        Err(UpdateError::Busy)
    ));
    acknowledge(&engine, "iceon-1", 2);
    drop(engine.take_ready(|| true).unwrap());
}

#[test]
fn preparation_freezes_admission_and_needs_attempt_scoped_receipts() {
    let engine = staged_engine();
    admit(&engine, "main", 1);
    engine.begin_preparation().unwrap();
    let attempt = engine.snapshot().preparation_id.unwrap();
    assert_eq!(attempt.len(), 32);
    assert!(engine.gate.admit("iceon-1").is_err());
    engine.report_prepared("main", 1, "old-attempt", true);
    engine.report_prepared("main", 2, &attempt, true);
    assert!(matches!(
        engine.take_ready(|| panic!("no receipt")),
        Err(UpdateError::Busy)
    ));
    engine.report_prepared("main", 1, &attempt, true);
    let stage = engine.take_ready(|| true).unwrap();
    assert!(engine.gate.admit("iceon-1").is_err());
    drop(stage);
}

#[tokio::test(start_paused = true)]
async fn timeout_and_unsafe_receipts_thaw_without_reserving_backend() {
    let engine = staged_engine();
    admit(&engine, "main", 1);
    engine.begin_preparation().unwrap();
    let first = engine.snapshot().preparation_id.unwrap();
    tokio::time::advance(PREPARATION_TIMEOUT).await;
    assert!(matches!(
        engine.take_ready(|| panic!("timed out")),
        Err(UpdateError::TimedOut)
    ));
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    assert!(engine.snapshot().preparation_id.is_none());
    let generation = engine.gate.admit("iceon-1").unwrap();
    engine.gate.forget("iceon-1", generation);
    engine.report_ready("main", 1, true);
    assert_eq!(engine.begin_preparation(), Err(UpdateError::Busy));
    tokio::time::advance(READY_LEASE).await;
    engine.report_ready("main", 1, true);
    engine.begin_preparation().unwrap();
    assert_ne!(
        engine.snapshot().preparation_id.as_deref(),
        Some(first.as_str())
    );
    engine.report_prepared("main", 1, &first, false);
    assert_eq!(engine.snapshot().phase, Phase::Preparing);
    let second = engine.snapshot().preparation_id.unwrap();
    engine.report_prepared("main", 1, &second, false);
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    assert!(matches!(
        engine.take_ready(|| panic!("unsafe")),
        Err(UpdateError::Busy)
    ));
}

#[test]
fn delayed_unsafe_report_and_recreated_window_do_not_inherit_acknowledgement() {
    let engine = staged_engine();
    let generation = admit(&engine, "main", 1);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    engine.report_ready("main", 1, false);
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    engine.gate.forget("main", generation);
    let next = engine.gate.admit("main").unwrap();
    engine.gate.complete("main", next, Some(2));
    engine.gate.forget("main", generation);
    engine.report_ready("main", 1, true);
    assert!(!engine.gate.0.lock().unwrap().all_ready());
    assert!(engine.gate.0.lock().unwrap().windows.contains_key("main"));
    engine.shutdown();
    assert!(engine.snapshot().preparation_id.is_none());
}

#[tokio::test(start_paused = true)]
async fn receipt_expiry_blocks_install_and_window_close_removes_its_obligation() {
    let engine = staged_engine();
    admit(&engine, "main", 1);
    let generation = admit(&engine, "iceon-1", 2);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    engine.gate.forget("iceon-1", generation);
    tokio::time::advance(READY_LEASE).await;
    assert!(matches!(
        engine.take_ready(|| panic!("expired")),
        Err(UpdateError::Busy)
    ));
    acknowledge(&engine, "main", 1);
    drop(engine.take_ready(|| true).unwrap());
}
fn admit(engine: &UpdateEngine, label: &str, identity: usize) -> u64 {
    let generation = engine.gate.admit(label).unwrap();
    engine.gate.complete(label, generation, Some(identity));
    engine.report_ready(label, identity, true);
    generation
}
fn acknowledge(engine: &UpdateEngine, label: &str, identity: usize) {
    let attempt = engine.snapshot().preparation_id.unwrap();
    engine.report_prepared(label, identity, &attempt, true);
}
fn staged_engine() -> Arc<UpdateEngine> {
    let engine = UpdateEngine::new(Phase::Ready, None);
    engine.inner.lock().unwrap().staged = Some(Staged {
        version: "1.2.3".into(),
        package: Box::new(FakePackage),
    });
    engine
}

#[test]
fn installation_claim_is_guarded_and_failure_never_restarts() {
    struct CountPackage(Arc<AtomicUsize>);
    impl Package for CountPackage {
        fn install(self: Box<Self>) -> Result<(), UpdateError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(UpdateError::InstallFailed)
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let engine = UpdateEngine::new(Phase::Ready, None);
    engine.inner.lock().unwrap().staged = Some(Staged {
        version: "0.0.3".into(),
        package: Box::new(CountPackage(calls.clone())),
    });
    admit(&engine, "main", 1);
    admit(&engine, "iceon-1", 2);
    assert!(matches!(
        engine.take_ready(|| panic!("must not shut down")),
        Err(UpdateError::Busy)
    ));
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    acknowledge(&engine, "iceon-1", 2);
    assert!(matches!(
        engine.take_ready(|| false),
        Err(UpdateError::Busy)
    ));
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    engine.gate.0.lock().unwrap().retry_after = None;
    engine.report_ready("main", 1, true);
    engine.report_ready("iceon-1", 2, true);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    acknowledge(&engine, "iceon-1", 2);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let staged = engine.take_ready(|| true).unwrap();
    assert_eq!(staged.package.install(), Err(UpdateError::InstallFailed));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(matches!(engine.take_ready(|| true), Err(UpdateError::Busy)));
}

#[tokio::test]
async fn backend_gate_preserves_inflight_work_and_closes_session_admission() {
    let directory = tempfile::tempdir().unwrap();
    let catalog = Arc::new(crate::catalog::CatalogEngine::new_with_home(
        directory.path().to_owned(),
        None,
    ));
    let connections = crate::connection::ConnectionEngine::new(catalog);
    assert!(!connections.has_active_runtime());
    assert!(connections.prepare_update_shutdown());
    assert_eq!(
        connections
            .open(crate::connection::OpenRequest {
                cluster_id: "fixture".into()
            })
            .await
            .unwrap_err(),
        crate::connection::ConnectionError::Busy
    );
    connections.finish_update_failure();
}

#[tokio::test(start_paused = true)]
async fn readiness_requires_every_present_window_and_fresh_lease() {
    let engine = staged_engine();
    admit(&engine, "main", 1);
    let pending = engine.gate.admit("iceon-1").unwrap();
    assert_eq!(engine.begin_preparation(), Err(UpdateError::Busy));
    engine.gate.complete("iceon-1", pending, Some(2));
    engine.report_ready("iceon-1", 2, false);
    assert!(!engine.gate.0.lock().unwrap().all_ready());
    engine.report_ready("iceon-1", 2, true);
    assert!(engine.gate.0.lock().unwrap().all_ready());
    tokio::time::advance(READY_LEASE).await;
    assert!(!engine.gate.0.lock().unwrap().all_ready());
    engine.report_ready("main", 1, true);
    engine.gate.forget("iceon-1", pending);
    assert!(engine.gate.0.lock().unwrap().all_ready());
}

#[test]
fn target_asset_and_semver_policy_rejects_wrong_archives_and_downgrades() {
    assert_eq!(
        Target::for_platform("windows", "x86"),
        Some(Target::WindowsX86)
    );
    assert_eq!(Target::for_platform("windows", "x86_64"), None);
    assert_eq!(Target::for_platform("linux", "aarch64"), None);
    assert_eq!(Target::WindowsX86.key(), "windows-i686");
    let win = "https://github.com/yan-ad/iceon/releases/download/1.2.3/Iceon_1.2.3_x86-setup.exe";
    assert!(asset_allowed(
        &Url::parse(win).unwrap(),
        "1.2.3",
        Target::WindowsX86
    ));
    assert!(!asset_allowed(
        &Url::parse(win).unwrap(),
        "1.2.3",
        Target::MacArm
    ));
    for invalid in [
        win.replace("1.2.3_x86", "1.2.4_x86"),
        win.replace("-setup.exe", ".msi"),
        win.replace("-setup.exe", ".nsis.zip"),
        format!("{win}?token=secret"),
        win.replace("github.com", "user:pass@github.com"),
        win.replace("/1.2.3/", "/0.9.0/"),
    ] {
        assert!(!asset_allowed(
            &Url::parse(&invalid).unwrap(),
            "1.2.3",
            Target::WindowsX86
        ));
    }
    assert!(newer_release("0.0.3", "0.0.2").unwrap());
    for version in ["0.0.2", "0.0.1", "0.0.2+build.3"] {
        assert!(!newer_release(version, "0.0.2").unwrap());
    }
    assert!(newer_release("invalid", "0.0.2").is_err());
}

#[test]
fn explicit_checks_preserve_disabled_unsigned_state() {
    let engine = UpdateEngine::new(Phase::Disabled, Some(UpdateError::TrustNotConfigured));
    let snapshot = engine.request_check();
    assert_eq!(snapshot.phase, Phase::Disabled);
    assert_eq!(snapshot.error, Some(UpdateError::TrustNotConfigured));
    engine.shutdown();
    assert_eq!(engine.request_check().phase, Phase::Stopped);
}

#[tokio::test(start_paused = true)]
async fn explicit_check_retries_before_background_interval() {
    let engine = UpdateEngine::new(Phase::Idle, None);
    let fake = Arc::new(Fake {
        calls: AtomicUsize::new(0),
        delay: Duration::from_secs(1),
        ready: false,
    });
    engine.launch(fake.clone(), &tokio::runtime::Handle::current());
    settle().await;
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    assert_eq!(engine.snapshot().phase, Phase::Error);
    engine.request_check();
    settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 2);
    engine.shutdown();
    engine.drain().await;
}
struct FakePackage;
impl Package for FakePackage {
    fn install(self: Box<Self>) -> Result<(), UpdateError> {
        panic!("tests never install")
    }
}
impl Provider for Fake {
    fn stage(&self, _: Arc<Mutex<Inner>>) -> BoxFuture<'_, Result<Option<Staged>, UpdateError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(self.delay).await;
            if self.ready {
                Ok(Some(Staged {
                    version: "1.2.3".into(),
                    package: Box::new(FakePackage),
                }))
            } else {
                Err(UpdateError::VerificationFailed)
            }
        })
    }
}
async fn settle() {
    for _ in 0..8 {
        tokio::task::yield_now().await;
    }
}
#[tokio::test(start_paused = true)]
async fn startup_cadence_errors_retry_and_cancellation() {
    let engine = UpdateEngine::new(Phase::Idle, None);
    let fake = Arc::new(Fake {
        calls: AtomicUsize::new(0),
        delay: Duration::from_secs(2),
        ready: false,
    });
    engine.launch(fake.clone(), &tokio::runtime::Handle::current());
    settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(2)).await;
    settle().await;
    assert_eq!(engine.snapshot().phase, Phase::Error);
    tokio::time::advance(Duration::from_secs(297)).await;
    settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 2);
    engine.shutdown();
    engine.drain().await;
    assert_eq!(engine.snapshot().phase, Phase::Stopped);
}
#[tokio::test(start_paused = true)]
async fn staging_is_required_and_restart_is_exclusive() {
    let engine = UpdateEngine::new(Phase::Idle, None);
    assert!(matches!(
        engine.take_ready(|| true),
        Err(UpdateError::NotReady)
    ));
    let fake = Arc::new(Fake {
        calls: AtomicUsize::new(0),
        delay: Duration::from_secs(100),
        ready: true,
    });
    engine.launch(fake.clone(), &tokio::runtime::Handle::current());
    settle().await;
    tokio::time::advance(Duration::from_secs(50)).await;
    settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    assert_eq!(engine.snapshot().phase, Phase::Checking);
    tokio::time::advance(Duration::from_secs(50)).await;
    settle().await;
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    admit(&engine, "main", 1);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    assert!(matches!(
        engine.take_ready(|| false),
        Err(UpdateError::Busy)
    ));
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    engine.gate.0.lock().unwrap().retry_after = None;
    engine.report_ready("main", 1, true);
    engine.begin_preparation().unwrap();
    acknowledge(&engine, "main", 1);
    let staged = engine.take_ready(|| true).unwrap();
    assert!(matches!(engine.take_ready(|| true), Err(UpdateError::Busy)));
    drop(staged);
    engine.shutdown();
    engine.drain().await;
}
#[test]
fn byte_limits_proxy_and_asset_scope() {
    let mut bytes = vec![0; 3];
    assert_eq!(
        append_bounded(&mut bytes, &[1, 2], 4),
        Err(UpdateError::LimitExceeded)
    );
    assert_eq!(bytes.len(), 3);
    assert!(validate_proxy("http://localhost:8080").is_ok());
    for proxy in [
        "file:///tmp/proxy",
        "http://user:secret@host",
        "https://host/?token=secret",
    ] {
        assert!(validate_proxy(proxy).is_err());
    }
    assert!(asset_allowed(
        &Url::parse("https://github.com/yan-ad/iceon/releases/download/v1.2.3/Iceon_1.2.3_aarch64.app.tar.gz")
            .unwrap(), "1.2.3", Target::MacArm
    ));
    for asset in [
        "http://github.com/yan-ad/iceon/releases/download/v1/x.app.tar.gz",
        "https://github.com/evil/taulens/releases/download/v1/x.app.tar.gz",
        "https://github.com/yan-ad/iceon/releases/latest/download/x.app.tar.gz",
    ] {
        assert!(!asset_allowed(
            &Url::parse(asset).unwrap(),
            "1.2.3",
            Target::MacArm
        ));
    }
}

#[tokio::test(start_paused = true)]
async fn total_deadline_drops_inflight_and_shutdown_clears_stage() {
    let engine = UpdateEngine::new(Phase::Idle, None);
    let fake = Arc::new(Fake {
        calls: AtomicUsize::new(0),
        delay: Duration::from_secs(999),
        ready: true,
    });
    engine.launch(fake.clone(), &tokio::runtime::Handle::current());
    settle().await;
    tokio::time::advance(CHECK_TIMEOUT + DOWNLOAD_TIMEOUT).await;
    settle().await;
    assert_eq!(engine.snapshot().error, Some(UpdateError::TimedOut));
    assert!(engine.inner.lock().unwrap().staged.is_none());
    engine.shutdown();
    engine.drain().await;
    tokio::time::advance(INTERVAL).await;
    settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
}
