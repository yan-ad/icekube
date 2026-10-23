use super::{tests::*, *};
use std::cell::RefCell;

fn request(id: &str) -> OpenWebLinkRequest {
    OpenWebLinkRequest { id: id.into() }
}

#[cfg(unix)]
#[test]
fn saved_link_open_rejects_storage_symlinks() {
    use std::os::unix::fs::symlink;
    for name in [
        "catalog.sqlite3",
        "catalog.lock",
        "catalog.sqlite3-journal",
        "catalog.sqlite3-wal",
        "catalog.sqlite3-shm",
    ] {
        let (dir, engine, _) = fixture();
        let saved = add(&engine, "https://example.test").unwrap();
        let path = engine.directory.join(name);
        let target = dir.path().join("target");
        if path.exists() {
            fs::rename(&path, &target).unwrap();
        } else {
            fs::write(&target, "fixture").unwrap();
        }
        let before = fs::read(&target).unwrap();
        symlink(&target, &path).unwrap();
        assert_eq!(
            engine.open_web_link_with(
                request(&saved.web_links[0].id),
                |_| -> std::result::Result<(), ()> { panic!("storage symlink reached opener") }
            ),
            Err(CatalogError::StoreCorrupt)
        );
        assert_eq!(fs::read(&target).unwrap(), before);
    }
}

#[test]
fn tampered_link_identity_and_old_schema_are_not_repaired_on_open() {
    let (_dir, engine, _) = fixture();
    let saved = add(&engine, "https://example.test").unwrap();
    let id = &saved.web_links[0].id;
    let database = engine.directory.join("catalog.sqlite3");
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute("UPDATE web_links SET url='https://other.test/'", [])
        .unwrap();
    drop(connection);
    let before = fs::read(&database).unwrap();
    assert_eq!(
        engine.open_web_link_with(request(id), |_| -> std::result::Result<(), ()> {
            panic!("mismatched URL identity reached opener")
        }),
        Err(CatalogError::StoreCorrupt)
    );
    assert_eq!(fs::read(&database).unwrap(), before);

    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch(
            "PRAGMA ignore_check_constraints=ON;
             UPDATE web_links SET url='https://example.test/';
             UPDATE metadata SET schema_version=1;",
        )
        .unwrap();
    drop(connection);
    let before = fs::read(&database).unwrap();
    assert_eq!(
        engine.open_web_link_with(request(id), |_| -> std::result::Result<(), ()> {
            panic!("old schema reached opener")
        }),
        Err(CatalogError::StoreCorrupt)
    );
    assert_eq!(fs::read(&database).unwrap(), before);
}

#[test]
fn saved_link_opens_once_without_discovery_or_storage_changes() {
    let (dir, engine, _) = fixture();
    let saved = add(&engine, "HTTPS://EXAMPLE.TEST:443/docs").unwrap();
    let home = dir.path().join("home");
    fs::create_dir_all(home.join(".kube")).unwrap();
    fs::write(home.join(".kube/config"), CONFIG).unwrap();
    let engine = CatalogEngine::new_with_home(engine.directory.clone(), Some(home));
    let database = engine.directory.join("catalog.sqlite3");
    let before = fs::read(&database).unwrap();
    let modified = fs::metadata(&database).unwrap().modified().unwrap();
    let calls = RefCell::new(Vec::new());
    assert_eq!(
        engine.open_web_link_with(request(&saved.web_links[0].id), |url| {
            calls.borrow_mut().push(url.to_owned());
            Ok::<_, ()>(())
        }),
        Ok(())
    );
    assert_eq!(*calls.borrow(), ["https://example.test/docs"]);
    assert_eq!(fs::read(&database).unwrap(), before);
    assert_eq!(
        fs::metadata(&database).unwrap().modified().unwrap(),
        modified
    );
    assert_eq!(
        storage::read_existing(&engine.directory)
            .unwrap()
            .snapshot(None, None),
        saved
    );
    // Prove that the fixture would change the catalog if discovery had run.
    assert_eq!(engine.list().unwrap().clusters.len(), 1);
}

#[test]
fn opener_failure_is_fixed_and_does_not_change_saved_state() {
    let (_dir, engine, _) = fixture();
    let saved = add(&engine, "https://example.test").unwrap();
    let mut calls = 0;
    let error = engine
        .open_web_link_with(request(&saved.web_links[0].id), |_| {
            calls += 1;
            Err("SECRET OS error: https://private.invalid /private/host/path")
        })
        .unwrap_err();
    assert_eq!(calls, 1);
    assert_eq!(error, CatalogError::OpenFailed);
    assert_eq!(serde_json::to_string(&error).unwrap(), "\"openFailed\"");
    assert_eq!(engine.list().unwrap(), saved);
}

#[test]
fn invalid_missing_removed_and_cluster_ids_never_open() {
    let (_dir, engine, input) = fixture();
    let cluster = import(&engine, &input).unwrap().clusters[0].id.clone();
    let saved = add(&engine, "https://example.test").unwrap();
    for (id, error) in [
        ("".into(), CatalogError::InvalidInput),
        ("x".repeat(MAX_NAME + 1), CatalogError::InvalidInput),
        ("link-\0SECRET".into(), CatalogError::InvalidInput),
        (" missing ".into(), CatalogError::InvalidInput),
        ("missing".into(), CatalogError::NotFound),
        ("https://example.test/".into(), CatalogError::NotFound),
        (cluster, CatalogError::NotFound),
    ] {
        assert_eq!(
            engine.open_web_link_with(request(&id), |_| -> std::result::Result<(), ()> {
                panic!("rejected entry reached opener")
            }),
            Err(error)
        );
    }
    assert_eq!(engine.list().unwrap(), saved);
    let id = &saved.web_links[0].id;
    engine.remove(RemoveRequest { id: id.clone() }).unwrap();
    assert_eq!(
        engine.open_web_link_with(request(id), |_| -> std::result::Result<(), ()> {
            panic!("removed entry reached opener")
        }),
        Err(CatalogError::NotFound)
    );
}

#[test]
fn opening_missing_store_does_not_create_or_migrate_files() {
    let (dir, engine, _) = fixture();
    assert_eq!(
        engine.open_web_link_with(request("missing"), |_| Ok::<_, ()>(())),
        Err(CatalogError::NotFound)
    );
    assert!(!engine.directory.exists());
    fs::create_dir_all(&engine.directory).unwrap();
    let legacy = engine.directory.join("catalog.json");
    fs::write(&legacy, "SECRET legacy fixture").unwrap();
    assert_eq!(
        engine.open_web_link_with(request("missing"), |_| Ok::<_, ()>(())),
        Err(CatalogError::NotFound)
    );
    assert_eq!(fs::read_to_string(legacy).unwrap(), "SECRET legacy fixture");
    assert_eq!(fs::read_dir(dir.path().join("data")).unwrap().count(), 1);
}

#[test]
fn tampered_saved_urls_fail_closed_without_opening_or_rewriting() {
    for url in [
        "javascript:alert(1)",
        "file:///tmp/SECRET",
        "not a URL SECRET",
        "https://user:SECRET@example.test/",
        "https://example.test/?token=SECRET",
        "https://example.test/#SECRET",
        "HTTPS://EXAMPLE.TEST:443",
        &format!("https://example.test/{}", "x".repeat(MAX_URL)),
    ] {
        let (_dir, engine, _) = fixture();
        let saved = add(&engine, "https://example.test").unwrap();
        let database = engine.directory.join("catalog.sqlite3");
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection
            .execute(
                "UPDATE web_links SET url=?1, id=?2",
                rusqlite::params![url, link_id(url)],
            )
            .unwrap();
        drop(connection);
        let before = fs::read(&database).unwrap();
        assert_eq!(
            engine.open_web_link_with(request(&link_id(url)), |_| -> std::result::Result<(), ()> {
                panic!("tampered URL reached opener")
            }),
            Err(CatalogError::StoreCorrupt)
        );
        assert_eq!(fs::read(&database).unwrap(), before);
        assert_eq!(saved.revision, 1);
    }
}

#[test]
fn open_request_accepts_only_an_id() {
    assert!(serde_json::from_str::<OpenWebLinkRequest>(r#"{"id":"link-fixture"}"#).is_ok());
    for input in [
        r#"{}"#,
        r#"{"url":"https://example.test"}"#,
        r#"{"id":"link-fixture","url":"https://example.test"}"#,
    ] {
        assert!(serde_json::from_str::<OpenWebLinkRequest>(input).is_err());
    }
}
