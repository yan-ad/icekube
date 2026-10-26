use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
struct Fake { calls: AtomicUsize, delay: Duration, ready: bool }
struct FakePackage;
impl Package for FakePackage { fn install(self: Box<Self>) -> Result<(), UpdateError> { panic!("tests never install") } }
impl Provider for Fake {
    fn stage(&self, _: Arc<Mutex<Inner>>) -> BoxFuture<'_, Result<Option<Staged>, UpdateError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(self.delay).await;
            if self.ready { Ok(Some(Staged { version: "1.2.3".into(), package: Box::new(FakePackage) })) } else { Err(UpdateError::VerificationFailed) }
        })
    }
}
async fn settle() { for _ in 0..8 { tokio::task::yield_now().await; } }
#[tokio::test(start_paused = true)]
async fn startup_cadence_errors_retry_and_cancellation() {
    let engine = UpdateEngine::new(Phase::Idle, None);
    let fake = Arc::new(Fake { calls: AtomicUsize::new(0), delay: Duration::from_secs(2), ready: false });
    engine.launch(fake.clone(), &tokio::runtime::Handle::current()); settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(2)).await; settle().await;
    assert_eq!(engine.snapshot().phase, Phase::Error);
    tokio::time::advance(Duration::from_secs(297)).await; settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    tokio::time::advance(Duration::from_secs(1)).await; settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 2);
    engine.shutdown(); engine.drain().await;
    assert_eq!(engine.snapshot().phase, Phase::Stopped);
}
#[tokio::test(start_paused = true)]
async fn staging_is_required_and_restart_is_exclusive() {
    let engine = UpdateEngine::new(Phase::Idle, None);
    assert!(matches!(engine.take_ready(), Err(UpdateError::NotReady)));
    let fake = Arc::new(Fake { calls: AtomicUsize::new(0), delay: Duration::from_secs(400), ready: true });
    engine.launch(fake.clone(), &tokio::runtime::Handle::current()); settle().await;
    tokio::time::advance(Duration::from_secs(300)).await; settle().await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    assert_eq!(engine.snapshot().phase, Phase::Checking);
    tokio::time::advance(Duration::from_secs(100)).await; settle().await;
    assert_eq!(engine.snapshot().phase, Phase::Ready);
    let staged = engine.take_ready().unwrap();
    assert!(matches!(engine.take_ready(), Err(UpdateError::Busy)));
    drop(staged);
    engine.shutdown(); engine.drain().await;
}
#[test]
fn byte_limits_proxy_and_asset_scope() {
    let mut bytes = vec![0; 3];
    assert_eq!(append_bounded(&mut bytes, &[1,2], 4), Err(UpdateError::LimitExceeded));
    assert_eq!(bytes.len(), 3);
    assert!(validate_proxy("http://localhost:8080").is_ok());
    for proxy in ["file:///tmp/proxy", "http://user:secret@host", "https://host/?token=secret"] { assert!(validate_proxy(proxy).is_err()); }
    assert!(asset_allowed(&Url::parse("https://github.com/yan-ad/taulens/releases/download/v1.2.3/icekube.app.tar.gz").unwrap()));
    for asset in ["http://github.com/yan-ad/taulens/releases/download/v1/x.app.tar.gz", "https://github.com/evil/taulens/releases/download/v1/x.app.tar.gz", "https://github.com/yan-ad/taulens/releases/latest/download/x.app.tar.gz"] { assert!(!asset_allowed(&Url::parse(asset).unwrap())); }
}
