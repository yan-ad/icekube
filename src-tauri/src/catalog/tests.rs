use super::*;

const CONFIG: &str = "apiVersion: v1\nkind: Config\nclusters:\n- name: fixture\n  cluster:\n    server: https://secret-server.invalid\n    certificate-authority-data: SECRET_CERT\ncontexts:\n- name: development\n  context:\n    cluster: fixture\n    user: secret-user\nusers:\n- name: secret-user\n  user:\n    token: SECRET_TOKEN\n    exec:\n      command: NEVER_EXECUTE\n";
fn fixture() -> (tempfile::TempDir, CatalogEngine, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("fixture.yaml");
    fs::write(&input, CONFIG).unwrap();
    let engine = CatalogEngine::new(dir.path().join("data"));
    (dir, engine, input)
}
fn import(engine: &CatalogEngine, path: &Path) -> Result<CatalogSnapshot> {
    engine.import_kubeconfig(ImportRequest {
        path: path.to_str().unwrap().into(),
    })
}
fn add(engine: &CatalogEngine, url: &str) -> Result<CatalogSnapshot> {
    engine.add_web_link(AddWebLinkRequest {
        name: "Documentation".into(),
        url: url.into(),
    })
}

#[test]
fn persistence_redaction_dedup_and_stale_reimport() {
    let (dir, engine, input) = fixture();
    assert_eq!(engine.list().unwrap().revision, 0);
    assert!(!dir.path().join("data").exists());
    let first = import(&engine, &input).unwrap();
    assert_eq!(first.clusters[0].source, "fixture.yaml");
    assert_eq!(first.clusters[0].status, "disconnected");
    assert_eq!(import(&engine, &input).unwrap(), first);
    let id = first.clusters[0].id.clone();
    let pinned = engine
        .set_pin(PinRequest {
            id: id.clone(),
            pinned: true,
        })
        .unwrap();
    assert_eq!(import(&engine, &input).unwrap(), pinned);
    let restarted = CatalogEngine::new(dir.path().join("data"));
    assert_eq!(restarted.list().unwrap(), pinned);
    let snapshot = serde_json::to_string(&pinned).unwrap();
    let stored = fs::read_to_string(dir.path().join("data/catalog.json")).unwrap();
    for secret in [
        "SECRET_TOKEN",
        "SECRET_CERT",
        "NEVER_EXECUTE",
        "secret-user",
        "secret-server",
    ] {
        assert!(!snapshot.contains(secret));
        assert!(!stored.contains(secret));
    }
    assert!(!snapshot.contains(dir.path().to_str().unwrap()));
    fs::write(&input, CONFIG.replace("development", "production")).unwrap();
    let changed = import(&engine, &input).unwrap();
    assert_eq!(changed.clusters.len(), 1);
    assert!(!changed.clusters[0].pinned);
    assert_ne!(changed.clusters[0].id, id);
    assert_eq!(
        engine.set_pin(PinRequest { id, pinned: true }),
        Err(CatalogError::NotFound)
    );
    fs::write(
        &input,
        "apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\n",
    )
    .unwrap();
    assert!(import(&engine, &input).unwrap().clusters.is_empty());
}

#[test]
fn malformed_imports_are_sanitized_and_transactional() {
    let (_dir, engine, input) = fixture();
    let first = import(&engine, &input).unwrap();
    for content in [
        "SECRET_TOKEN: [",
        "apiVersion: wrong\nkind: Config\nclusters: []\ncontexts: []",
        "apiVersion: v1\nkind: Wrong\nclusters: []\ncontexts: []",
        "apiVersion: v1\nkind: Config\nclusters: []\ncontexts:\n- name: x\n  context: {cluster: missing}",
        "apiVersion: v1\nkind: Config\nclusters:\n- name: x\n- name: x\ncontexts: []",
    ] {
        fs::write(&input, content).unwrap();
        let error = import(&engine, &input).unwrap_err();
        assert_eq!(error, CatalogError::InvalidKubeconfig);
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            "\"invalidKubeconfig\""
        );
        assert_eq!(engine.list().unwrap(), first);
    }
    fs::write(
        &input,
        CONFIG.replace(
            "users:",
            "- name: development\n  context: {cluster: fixture}\nusers:",
        ),
    )
    .unwrap();
    assert_eq!(
        import(&engine, &input),
        Err(CatalogError::InvalidKubeconfig)
    );
    fs::write(&input, vec![b'x'; MAX_INPUT + 1]).unwrap();
    assert_eq!(import(&engine, &input), Err(CatalogError::LimitExceeded));
    assert_eq!(
        import(&engine, input.parent().unwrap()),
        Err(CatalogError::InputUnavailable)
    );
    assert_eq!(engine.list().unwrap(), first);
}

#[test]
fn web_url_validation_and_entry_pins() {
    let (_dir, engine, _) = fixture();
    for url in [
        "file:///tmp/x",
        "javascript:alert(1)",
        "https://user:SECRET@example.test",
        "https://@example.test",
        "https://example.test/?token=SECRET",
        "https://example.test/#SECRET",
        " https://example.test",
        "https://example.test/\n",
        "https:\\example.test",
        "not a URL",
    ] {
        assert_eq!(add(&engine, url), Err(CatalogError::InvalidInput));
    }
    let first = add(&engine, "HTTPS://EXAMPLE.TEST:443").unwrap();
    assert_eq!(first.web_links[0].url, "https://example.test/");
    assert_eq!(
        add(&engine, "https://example.test/"),
        Err(CatalogError::Duplicate)
    );
    let id = first.web_links[0].id.clone();
    let pinned = engine
        .set_pin(PinRequest {
            id: id.clone(),
            pinned: true,
        })
        .unwrap();
    assert!(pinned.web_links[0].pinned);
    assert_eq!(
        engine
            .set_pin(PinRequest {
                id: id.clone(),
                pinned: true
            })
            .unwrap(),
        pinned
    );
    for id in ["clusters", "web-links", "catalog"] {
        assert_eq!(
            engine.set_pin(PinRequest {
                id: id.into(),
                pinned: true
            }),
            Err(CatalogError::NotFound)
        );
    }
    let removed = engine.remove(RemoveRequest { id: id.clone() }).unwrap();
    assert!(removed.web_links.is_empty());
    assert_eq!(
        engine.remove(RemoveRequest { id }),
        Err(CatalogError::NotFound)
    );
}

#[test]
fn corrupt_store_is_never_replaced() {
    let (dir, engine, input) = fixture();
    add(&engine, "https://example.test").unwrap();
    let path = dir.path().join("data/catalog.json");
    for content in [
        "{SECRET",
        "{}",
        "{\"schemaVersion\":2,\"revision\":0,\"clusters\":[],\"webLinks\":[]}",
    ] {
        fs::write(&path, content).unwrap();
        assert_eq!(engine.list(), Err(CatalogError::StoreCorrupt));
        assert_eq!(import(&engine, &input), Err(CatalogError::StoreCorrupt));
        assert_eq!(
            add(&engine, "https://other.test"),
            Err(CatalogError::StoreCorrupt)
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), content);
    }
    fs::write(&path, vec![b'x'; MAX_STORE + 1]).unwrap();
    assert_eq!(engine.list(), Err(CatalogError::StoreCorrupt));
}

#[test]
fn replacement_failure_keeps_previous_state() {
    let (dir, engine, _) = fixture();
    let first = add(&engine, "https://example.test").unwrap();
    let original = fs::read(dir.path().join("data/catalog.json")).unwrap();
    let mut changed = engine.load().unwrap();
    changed.revision += 1;
    // A directory in place of the destination makes atomic replacement fail on every OS.
    fs::remove_file(dir.path().join("data/catalog.json")).unwrap();
    fs::create_dir(dir.path().join("data/catalog.json")).unwrap();
    assert_eq!(engine.save(&changed), Err(CatalogError::StoreUnavailable));
    fs::remove_dir(dir.path().join("data/catalog.json")).unwrap();
    fs::write(dir.path().join("data/catalog.json"), original).unwrap();
    assert_eq!(engine.list().unwrap(), first);
    assert_eq!(fs::read_dir(dir.path().join("data")).unwrap().count(), 1);
}

#[test]
fn bounds_schema_and_wire_contract() {
    let (_dir, engine, input) = fixture();
    for name in [
        "".into(),
        " padded ".into(),
        "x".repeat(MAX_NAME + 1),
        "bad\nname".into(),
    ] {
        assert_eq!(
            engine.add_web_link(AddWebLinkRequest {
                name,
                url: "https://example.test".into()
            }),
            Err(CatalogError::InvalidInput)
        );
    }
    assert_eq!(
        add(
            &engine,
            &format!("https://example.test/{}", "x".repeat(MAX_URL))
        ),
        Err(CatalogError::InvalidInput)
    );
    fs::write(
        &input,
        CONFIG.replace("development", &"x".repeat(MAX_NAME + 1)),
    )
    .unwrap();
    assert_eq!(
        import(&engine, &input),
        Err(CatalogError::InvalidKubeconfig)
    );
    let mut config =
        "apiVersion: v1\nkind: Config\nclusters:\n- name: fixture\ncontexts:\n".to_owned();
    for i in 0..=MAX_ENTRIES {
        config.push_str(&format!(
            "- name: ctx{i}\n  context: {{cluster: fixture}}\n"
        ));
    }
    fs::write(&input, config).unwrap();
    assert_eq!(import(&engine, &input), Err(CatalogError::LimitExceeded));
    fs::write(&input, CONFIG).unwrap();
    let value = serde_json::to_value(import(&engine, &input).unwrap()).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 3);
    assert!(value.get("webLinks").is_some());
    let cluster = value["clusters"][0].as_object().unwrap();
    assert_eq!(cluster.len(), 6);
    assert!(cluster.contains_key("contextName"));
}

#[cfg(unix)]
#[test]
fn private_permissions_and_symlink_rejection() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let (dir, engine, input) = fixture();
    import(&engine, &input).unwrap();
    assert_eq!(
        fs::metadata(dir.path().join("data"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(dir.path().join("data/catalog.json"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let link = dir.path().join("link.yaml");
    symlink(&input, &link).unwrap();
    assert_eq!(import(&engine, &link), Err(CatalogError::InputUnavailable));
    fs::remove_file(dir.path().join("data/catalog.json")).unwrap();
    symlink(&input, dir.path().join("data/catalog.json")).unwrap();
    assert_eq!(engine.list(), Err(CatalogError::StoreCorrupt));
}

#[test]
fn concurrent_updates_are_serialized() {
    let (_dir, engine, _) = fixture();
    std::thread::scope(|scope| {
        for i in 0..12 {
            let engine = &engine;
            scope.spawn(move || {
                add(engine, &format!("https://fixture{i}.test")).unwrap();
            });
        }
    });
    let snapshot = engine.list().unwrap();
    assert_eq!(snapshot.web_links.len(), 12);
    assert_eq!(snapshot.revision, 12);
}

#[test]
fn catalog_capacity_and_revision_overflow_preserve_disk() {
    let (dir, engine, _) = fixture();
    let mut store = Store::empty();
    for i in 0..MAX_ENTRIES {
        let url = format!("https://fixture{i}.test/");
        store.web_links.push(WebLinkSummary {
            id: link_id(&url),
            name: format!("Link {i}"),
            url,
            pinned: false,
        });
    }
    engine.save(&store).unwrap();
    let original = fs::read(dir.path().join("data/catalog.json")).unwrap();
    assert_eq!(
        add(&engine, "https://extra.test"),
        Err(CatalogError::LimitExceeded)
    );
    assert_eq!(
        fs::read(dir.path().join("data/catalog.json")).unwrap(),
        original
    );
    store.web_links.clear();
    store.revision = u64::MAX;
    engine.save(&store).unwrap();
    assert_eq!(
        add(&engine, "https://extra.test"),
        Err(CatalogError::LimitExceeded)
    );
    assert_eq!(engine.list().unwrap().revision, u64::MAX);
}

#[test]
fn tampered_store_identity_fails_closed() {
    let (_dir, engine, _) = fixture();
    add(&engine, "https://example.test").unwrap();
    let mut store = engine.load().unwrap();
    store.web_links[0].id = "catalog".into();
    fs::write(
        engine.directory.join("catalog.json"),
        serde_json::to_vec(&store).unwrap(),
    )
    .unwrap();
    assert_eq!(engine.list(), Err(CatalogError::StoreCorrupt));
}
