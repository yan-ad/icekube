//! Normalized SQLite tables; DELETE journaling keeps sidecars short-lived. A private
//! lock file serializes initialization/migration across engine instances/processes;
//! BEGIN IMMEDIATE covers each read/modify/write. OS ACLs are inherited on Windows.
//! The legacy JSON and a non-overwriting .backup are retained, never used once SQLite exists.
use super::*;
use fs2::FileExt;
use rusqlite::{Connection, OpenFlags, params};
use std::{
    fs::OpenOptions,
    io::Write,
    time::{Duration, Instant},
};

const DATABASE: &str = "catalog.sqlite3";
const MAX_DATABASE: u64 = 16 * 1024 * 1024;
const SCHEMA: &str = "
CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), schema_version INTEGER NOT NULL CHECK(schema_version = 2), revision TEXT NOT NULL, auto_discover INTEGER NOT NULL CHECK(auto_discover IN (0,1))) STRICT;
CREATE TABLE clusters (id TEXT PRIMARY KEY NOT NULL, context_name TEXT NOT NULL, source_path TEXT NOT NULL, source_alias TEXT NOT NULL, pinned INTEGER NOT NULL CHECK(pinned IN (0,1)), color TEXT NOT NULL, UNIQUE(source_path, context_name)) STRICT;
CREATE TABLE web_links (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, pinned INTEGER NOT NULL CHECK(pinned IN (0,1)), color TEXT NOT NULL) STRICT;
";

pub(super) fn sql_error(error: rusqlite::Error) -> CatalogError {
    match error {
        rusqlite::Error::SqliteFailure(ref failure, _)
            if matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseCorrupt | rusqlite::ErrorCode::NotADatabase
            ) =>
        {
            CatalogError::StoreCorrupt
        }
        _ => CatalogError::StoreUnavailable,
    }
}
fn private(path: &Path, directory: bool) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| CatalogError::StoreUnavailable)?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(CatalogError::StoreCorrupt);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            path,
            fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
        )
        .map_err(|_| CatalogError::StoreUnavailable)?;
    }
    Ok(())
}
pub(super) fn lock(directory: &Path) -> Result<File> {
    if let Ok(metadata) = fs::symlink_metadata(directory)
        && (!metadata.is_dir() || metadata.file_type().is_symlink())
    {
        return Err(CatalogError::StoreUnavailable);
    }
    fs::create_dir_all(directory).map_err(|_| CatalogError::StoreUnavailable)?;
    private(directory, true)?;
    let path = directory.join("catalog.lock");
    match fs::symlink_metadata(&path) {
        Ok(_) => private(&path, false)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(CatalogError::StoreUnavailable),
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|_| CatalogError::StoreUnavailable)?;
    private(&path, false)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => break,
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(_) => return Err(CatalogError::StoreUnavailable),
        }
    }
    Ok(file)
}
fn connect(path: &Path) -> Result<Connection> {
    connect_with_access(path, false)
}
fn connect_with_access(path: &Path, read_only: bool) -> Result<Connection> {
    let path = fs::canonicalize(path).map_err(|_| CatalogError::StoreUnavailable)?;
    let connection = Connection::open_with_flags(
        &path,
        (if read_only {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        } else {
            OpenFlags::SQLITE_OPEN_READ_WRITE
        }) | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(sql_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sql_error)?;
    connection
        .set_limit(
            rusqlite::limits::Limit::SQLITE_LIMIT_LENGTH,
            MAX_STORE as i32,
        )
        .map_err(sql_error)?;
    connection
        .execute_batch(if read_only {
            "PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;"
        } else {
            "PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA max_page_count=4096;"
        })
        .map_err(sql_error)?;
    Ok(connection)
}
// Opening a saved link never initializes, migrates, discovers, or rewrites the catalog.
pub(super) fn read_existing(directory: &Path) -> Result<Store> {
    let path = directory.join(DATABASE);
    for (candidate, is_directory) in [(directory.to_path_buf(), true), (path.clone(), false)] {
        let metadata = fs::symlink_metadata(candidate).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CatalogError::NotFound
            } else {
                CatalogError::StoreUnavailable
            }
        })?;
        if metadata.file_type().is_symlink()
            || (is_directory && !metadata.is_dir())
            || (!is_directory
                && (!metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_DATABASE))
        {
            return Err(CatalogError::StoreCorrupt);
        }
    }
    for name in [
        "catalog.lock",
        "catalog.sqlite3-journal",
        "catalog.sqlite3-wal",
        "catalog.sqlite3-shm",
    ] {
        match fs::symlink_metadata(directory.join(name)) {
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
                return Err(CatalogError::StoreCorrupt);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(CatalogError::StoreUnavailable),
        }
    }
    let mut connection = connect_with_access(&path, true)?;
    let transaction = connection.transaction().map_err(sql_error)?;
    let check: String = transaction
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(|_| CatalogError::StoreCorrupt)?;
    let journal: String = transaction
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(sql_error)?;
    if check != "ok" || journal != "delete" {
        return Err(CatalogError::StoreCorrupt);
    }
    load(&transaction)
}
pub(super) fn open(directory: &Path) -> Result<Connection> {
    let path = directory.join(DATABASE);
    let exists = match fs::symlink_metadata(&path) {
        Ok(metadata) => {
            if metadata.len() == 0 || metadata.len() > MAX_DATABASE {
                return Err(CatalogError::StoreCorrupt);
            }
            private(&path, false)?;
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err(CatalogError::StoreUnavailable),
    };
    for suffix in ["-journal", "-wal", "-shm"] {
        let sidecar = directory.join(format!("{DATABASE}{suffix}"));
        match fs::symlink_metadata(&sidecar) {
            Ok(_) => private(&sidecar, false)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(CatalogError::StoreUnavailable),
        }
    }
    if !exists {
        let legacy = directory.join("catalog.json");
        let store = match fs::symlink_metadata(&legacy) {
            Ok(_) => {
                let bytes =
                    bounded_read(&legacy, MAX_STORE).map_err(|_| CatalogError::StoreCorrupt)?;
                let store = migrate(&bytes)?;
                backup(directory, &bytes)?;
                private(&legacy, false)?;
                store
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Store::empty(),
            Err(_) => return Err(CatalogError::StoreUnavailable),
        };
        let temp = tempfile::NamedTempFile::new_in(directory)
            .map_err(|_| CatalogError::StoreUnavailable)?;
        let mut connection = connect(temp.path())?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(sql_error)?;
        transaction.execute_batch(SCHEMA).map_err(sql_error)?;
        save(&transaction, &store)?;
        transaction.commit().map_err(sql_error)?;
        drop(connection);
        temp.as_file()
            .sync_all()
            .map_err(|_| CatalogError::StoreUnavailable)?;
        temp.persist_noclobber(&path)
            .map_err(|_| CatalogError::StoreUnavailable)?;
        #[cfg(unix)]
        File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| CatalogError::StoreUnavailable)?;
    }
    let mut connection = connect(&path)?;
    let check: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(|_| CatalogError::StoreCorrupt)?;
    if check != "ok" {
        return Err(CatalogError::StoreCorrupt);
    }
    let journal: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(sql_error)?;
    if journal != "delete" {
        return Err(CatalogError::StoreCorrupt);
    }
    upgrade(&mut connection)?;
    load(&connection)?;
    Ok(connection)
}
fn upgrade(connection: &mut Connection) -> Result<()> {
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(sql_error)?;
    let version: u32 = transaction
        .query_one(
            "SELECT schema_version FROM metadata WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .map_err(|_| CatalogError::StoreCorrupt)?;
    match version {
        1 => {
            // Validate all old rows before DDL; a failed upgrade rolls back intact.
            let store = load_version(&transaction, 1)?;
            transaction.execute_batch("
                ALTER TABLE clusters ADD COLUMN source_alias TEXT NOT NULL DEFAULT '';
                UPDATE clusters SET source_alias=source_path;
                ALTER TABLE metadata RENAME TO metadata_v1;
                CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), schema_version INTEGER NOT NULL CHECK(schema_version = 2), revision TEXT NOT NULL, auto_discover INTEGER NOT NULL CHECK(auto_discover IN (0,1))) STRICT;
                INSERT INTO metadata SELECT singleton, 2, revision, auto_discover FROM metadata_v1;
                DROP TABLE metadata_v1;
            ").map_err(|_| CatalogError::StoreCorrupt)?;
            if load(&transaction)?.revision != store.revision {
                return Err(CatalogError::StoreCorrupt);
            }
        }
        2 => {}
        _ => return Err(CatalogError::StoreCorrupt),
    }
    transaction.commit().map_err(sql_error)
}
pub(super) fn load(connection: &Connection) -> Result<Store> {
    load_version(connection, 2)
}
fn load_version(connection: &Connection, expected_version: u32) -> Result<Store> {
    let (schema_version, revision, auto_discover): (u32, String, i64) = connection
        .query_one(
            "SELECT schema_version, revision, auto_discover FROM metadata WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| CatalogError::StoreCorrupt)?;
    if schema_version != expected_version || !matches!(auto_discover, 0 | 1) {
        return Err(CatalogError::StoreCorrupt);
    }
    let mut store = Store {
        schema_version: 2,
        revision: revision.parse().map_err(|_| CatalogError::StoreCorrupt)?,
        auto_discover: auto_discover == 1,
        clusters: vec![],
        web_links: vec![],
    };
    let query = if expected_version == 1 {
        "SELECT id, context_name, source_path, pinned, color, source_path FROM clusters ORDER BY id LIMIT 1001"
    } else {
        "SELECT id, context_name, source_path, pinned, color, source_alias FROM clusters ORDER BY id LIMIT 1001"
    };
    let mut statement = connection
        .prepare(query)
        .map_err(|_| CatalogError::StoreCorrupt)?;
    let rows = statement
        .query_map([], |r| {
            Ok(ClusterRecord {
                id: r.get(0)?,
                context_name: r.get(1)?,
                source_path: r.get(2)?,
                provenance_path: r.get(5)?,
                pinned: r.get(3)?,
                color: r.get(4)?,
            })
        })
        .map_err(|_| CatalogError::StoreCorrupt)?;
    for row in rows {
        store
            .clusters
            .push(row.map_err(|_| CatalogError::StoreCorrupt)?);
    }
    let mut statement = connection
        .prepare("SELECT id, name, url, pinned, color FROM web_links ORDER BY id LIMIT 1001")
        .map_err(|_| CatalogError::StoreCorrupt)?;
    let rows = statement
        .query_map([], |r| {
            Ok(WebLinkSummary {
                id: r.get(0)?,
                name: r.get(1)?,
                url: r.get(2)?,
                pinned: r.get(3)?,
                color: r.get(4)?,
                source: "local".into(),
                labels: vec![],
            })
        })
        .map_err(|_| CatalogError::StoreCorrupt)?;
    for row in rows {
        store
            .web_links
            .push(row.map_err(|_| CatalogError::StoreCorrupt)?);
    }
    store.validate()?;
    validate_size(&store).map_err(|_| CatalogError::StoreCorrupt)?;
    Ok(store)
}
pub(super) fn validate_size(store: &Store) -> Result<()> {
    if store.clusters.len() + store.web_links.len() > MAX_ENTRIES
        || serde_json::to_vec(store)
            .map_err(|_| CatalogError::StoreUnavailable)?
            .len()
            > MAX_STORE
    {
        return Err(CatalogError::LimitExceeded);
    }
    Ok(())
}
pub(super) fn save(connection: &rusqlite::Transaction<'_>, store: &Store) -> Result<()> {
    validate_size(store)?;
    store.validate()?;
    connection
        .execute_batch("DELETE FROM clusters; DELETE FROM web_links; DELETE FROM metadata;")
        .map_err(sql_error)?;
    connection
        .execute(
            "INSERT INTO metadata VALUES (1, ?1, ?2, ?3)",
            params![
                store.schema_version,
                store.revision.to_string(),
                store.auto_discover
            ],
        )
        .map_err(sql_error)?;
    for c in &store.clusters {
        connection
            .execute(
                "INSERT INTO clusters (id, context_name, source_path, pinned, color, source_alias) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![c.id, c.context_name, c.source_path, c.pinned, c.color, c.provenance_path],
            )
            .map_err(sql_error)?;
    }
    for l in &store.web_links {
        connection
            .execute(
                "INSERT INTO web_links VALUES (?1, ?2, ?3, ?4, ?5)",
                params![l.id, l.name, l.url, l.pinned, l.color],
            )
            .map_err(sql_error)?;
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyStore {
    schema_version: u32,
    revision: u64,
    clusters: Vec<LegacyCluster>,
    web_links: Vec<LegacyLink>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyCluster {
    id: String,
    context_name: String,
    source_path: String,
    pinned: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyLink {
    id: String,
    name: String,
    url: String,
    pinned: bool,
}
fn migrate(bytes: &[u8]) -> Result<Store> {
    let legacy: LegacyStore =
        serde_json::from_slice(bytes).map_err(|_| CatalogError::StoreCorrupt)?;
    let mut store = Store {
        revision: legacy.revision,
        ..Store::empty()
    };
    if legacy.schema_version != 1 || legacy.clusters.len() + legacy.web_links.len() > MAX_ENTRIES {
        return Err(CatalogError::StoreCorrupt);
    }
    for c in legacy.clusters {
        let color = new_color(&store)?;
        store.clusters.push(ClusterRecord {
            id: c.id,
            context_name: c.context_name,
            provenance_path: c.source_path.clone(),
            source_path: c.source_path,
            pinned: c.pinned,
            color,
        });
    }
    for l in legacy.web_links {
        let color = new_color(&store)?;
        store.web_links.push(WebLinkSummary {
            id: l.id,
            name: l.name,
            url: l.url,
            pinned: l.pinned,
            color,
            source: "local".into(),
            labels: vec![],
        });
    }
    store.validate()?;
    validate_size(&store).map_err(|_| CatalogError::StoreCorrupt)?;
    Ok(store)
}
fn backup(directory: &Path, bytes: &[u8]) -> Result<()> {
    let path = directory.join("catalog.json.backup");
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            if bounded_read(&path, MAX_STORE).map_err(|_| CatalogError::StoreCorrupt)? != bytes {
                return Err(CatalogError::StoreCorrupt);
            }
            private(&path, false)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut temp = tempfile::NamedTempFile::new_in(directory)
                .map_err(|_| CatalogError::StoreUnavailable)?;
            temp.write_all(bytes)
                .and_then(|_| temp.as_file().sync_all())
                .map_err(|_| CatalogError::StoreUnavailable)?;
            temp.persist_noclobber(path)
                .map_err(|_| CatalogError::StoreUnavailable)?;
        }
        Err(_) => return Err(CatalogError::StoreUnavailable),
    }
    Ok(())
}
