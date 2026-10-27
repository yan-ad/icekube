//! Catalog workflow reference: Freelens v1.10.3-533, cd07118f843c4a69f937a319a37a7c12ef2c92d8,
//! common/catalog/catalog-entity.ts and common/catalog-entities/web-link.ts (behavior only).
//! CatalogEngine owns imported disconnected contexts, local links, and entry-only pins.
//! Snapshot results cover empty/loaded states; sanitized errors cover rejected/unavailable states.
//! Acceptance fixtures live in catalog/tests.rs and catalog/open_tests.rs.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_INPUT: usize = 1024 * 1024;
const MAX_STORE: usize = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 1000;
const MAX_NAME: usize = 256;
const MAX_URL: usize = 2048;
const MAX_PATH: usize = 4096;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CatalogError {
    InvalidInput,
    InvalidKubeconfig,
    InputUnavailable,
    LimitExceeded,
    Duplicate,
    NotFound,
    StoreUnavailable,
    StoreCorrupt,
    OpenFailed,
}

/// Ephemeral connection state projected onto a catalog entry. This is never
/// persisted with the catalog metadata.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterConnectionState {
    pub cluster_id: String,
    pub status: &'static str,
}
type Result<T> = std::result::Result<T, CatalogError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub revision: u64,
    pub clusters: Vec<ClusterSummary>,
    pub web_links: Vec<WebLinkSummary>,
    pub discovery_error: Option<CatalogError>,
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummary {
    pub id: String,
    pub name: String,
    pub context_name: String,
    pub source: String,
    pub status: &'static str,
    pub pinned: bool,
    pub labels: Vec<String>,
    pub color: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebLinkSummary {
    pub id: String,
    pub name: String,
    pub url: String,
    pub pinned: bool,
    pub source: String,
    pub labels: Vec<String>,
    pub color: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportRequest {
    pub path: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AddWebLinkRequest {
    pub name: String,
    pub url: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PinRequest {
    pub id: String,
    pub pinned: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoveRequest {
    pub id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenWebLinkRequest {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConnectionTarget {
    pub source_path: PathBuf,
    pub provenance_path: PathBuf,
    pub context_name: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: u32,
    revision: u64,
    clusters: Vec<ClusterRecord>,
    web_links: Vec<WebLinkSummary>,
    auto_discover: bool, // Legacy storage field; discovery no longer consults it.
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClusterRecord {
    id: String,
    context_name: String,
    source_path: String,
    provenance_path: String,
    pinned: bool,
    color: String,
}
impl Store {
    fn empty() -> Self {
        Self {
            schema_version: 2,
            ..Self::default()
        }
    }
    fn snapshot(
        &self,
        home: Option<&Path>,
        discovery_error: Option<CatalogError>,
    ) -> CatalogSnapshot {
        let mut clusters: Vec<_> = self
            .clusters
            .iter()
            .map(|c| ClusterSummary {
                id: c.id.clone(),
                name: c.context_name.clone(),
                context_name: c.context_name.clone(),
                source: "kubeconfig".into(),
                labels: vec![source_label(&c.provenance_path, home)],
                color: c.color.clone(),
                status: "disconnected",
                pinned: c.pinned,
            })
            .collect();
        clusters.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        let mut web_links = self.web_links.clone();
        web_links.sort_by(|a, b| (&a.name, &a.id).cmp(&(&b.name, &b.id)));
        CatalogSnapshot {
            revision: self.revision,
            clusters,
            web_links,
            discovery_error,
        }
    }
    fn validate(&self) -> Result<()> {
        if self.schema_version != 2 || self.clusters.len() + self.web_links.len() > MAX_ENTRIES {
            return Err(CatalogError::StoreCorrupt);
        }
        let mut ids = HashSet::new();
        let mut urls = HashSet::new();
        for c in &self.clusters {
            let path = Path::new(&c.source_path);
            if !valid_name(&c.context_name)
                || c.source_path.len() > MAX_PATH
                || !path.is_absolute()
                || !path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(valid_name)
                || !valid_source_path(&c.provenance_path)
                || c.id != cluster_id(&c.source_path, &c.context_name)
                || !valid_color(&c.color)
                || !ids.insert(&c.id)
            {
                return Err(CatalogError::StoreCorrupt);
            }
        }
        for l in &self.web_links {
            if !valid_name(&l.name)
                || normalize_url(&l.url).ok().as_ref() != Some(&l.url)
                || l.id != link_id(&l.url)
                || !valid_color(&l.color)
                || l.source != "local"
                || !l.labels.is_empty()
                || !ids.insert(&l.id)
                || !urls.insert(&l.url)
            {
                return Err(CatalogError::StoreCorrupt);
            }
        }
        Ok(())
    }
}

mod storage;

// Home is injected by Tauri. Constructors never read it or infer a host HOME.
// Discovery is a bounded metadata import on list, not a watcher or connection.
pub struct CatalogEngine {
    directory: PathBuf,
    home: Option<PathBuf>,
    operations: Mutex<()>,
}
impl CatalogEngine {
    #[cfg(test)]
    pub fn new(directory: PathBuf) -> Self {
        Self::new_with_home(directory, None)
    }
    pub fn new_with_home(directory: PathBuf, home: Option<PathBuf>) -> Self {
        Self {
            directory,
            home,
            operations: Mutex::new(()),
        }
    }
    pub fn list(&self) -> Result<CatalogSnapshot> {
        self.change_inner(|_| Ok(false), true)
    }

    pub(crate) fn connection_target(&self, id: &str) -> Result<ConnectionTarget> {
        if !valid_name(id) {
            return Err(CatalogError::InvalidInput);
        }
        let _guard = self
            .operations
            .lock()
            .map_err(|_| CatalogError::StoreUnavailable)?;
        let store = storage::read_existing(&self.directory)?;
        let cluster = store
            .clusters
            .iter()
            .find(|cluster| cluster.id == id)
            .ok_or(CatalogError::NotFound)?;
        Ok(ConnectionTarget {
            source_path: PathBuf::from(&cluster.source_path),
            provenance_path: PathBuf::from(&cluster.provenance_path),
            context_name: cluster.context_name.clone(),
        })
    }
    pub(crate) fn open_web_link_with<E>(
        &self,
        request: OpenWebLinkRequest,
        open: impl FnOnce(&str) -> std::result::Result<(), E>,
    ) -> Result<()> {
        if !valid_name(&request.id) {
            return Err(CatalogError::InvalidInput);
        }
        let url = {
            let _guard = self
                .operations
                .lock()
                .map_err(|_| CatalogError::StoreUnavailable)?;
            let store = storage::read_existing(&self.directory)?;
            let link = store
                .web_links
                .iter()
                .find(|link| link.id == request.id)
                .ok_or(CatalogError::NotFound)?;
            normalize_url(&link.url).map_err(|_| CatalogError::StoreCorrupt)?
        };
        // Do not hold catalog locks while the OS hands off to the default browser.
        open(&url).map_err(|_| CatalogError::OpenFailed)
    }
    fn change(&self, update: impl FnOnce(&mut Store) -> Result<bool>) -> Result<CatalogSnapshot> {
        self.change_inner(update, false)
    }
    fn change_inner(
        &self,
        update: impl FnOnce(&mut Store) -> Result<bool>,
        discover: bool,
    ) -> Result<CatalogSnapshot> {
        let _guard = self
            .operations
            .lock()
            .map_err(|_| CatalogError::StoreUnavailable)?;
        let _file_lock = storage::lock(&self.directory)?;
        let mut connection = storage::open(&self.directory)?;
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(storage::sql_error)?;
        let mut store = storage::load(&transaction)?;
        let mut changed = update(&mut store)?;
        let mut discovery_error = None;
        if discover && let Some(home) = &self.home {
            match discover_default(&mut store, &home.join(".kube/config")) {
                Ok(import_changed) => changed |= import_changed,
                Err(error) => discovery_error = Some(error),
            }
        }
        if changed {
            store.revision = store
                .revision
                .checked_add(1)
                .ok_or(CatalogError::LimitExceeded)?;
            storage::save(&transaction, &store)?;
        }
        transaction.commit().map_err(storage::sql_error)?;
        Ok(store.snapshot(self.home.as_deref(), discovery_error))
    }
    pub fn import_kubeconfig(&self, request: ImportRequest) -> Result<CatalogSnapshot> {
        if request.path.is_empty()
            || request.path.len() > MAX_PATH
            || request.path.contains('\0')
            || !Path::new(&request.path).is_absolute()
        {
            return Err(CatalogError::InvalidInput);
        }
        self.change(|store| reconcile(store, Path::new(&request.path)))
    }
    pub fn add_web_link(&self, request: AddWebLinkRequest) -> Result<CatalogSnapshot> {
        if !valid_name(&request.name) {
            return Err(CatalogError::InvalidInput);
        }
        let url = normalize_url(&request.url)?;
        self.change(|store| {
            if store.web_links.iter().any(|l| l.url == url) {
                return Err(CatalogError::Duplicate);
            }
            store.web_links.push(WebLinkSummary {
                id: link_id(&url),
                name: request.name,
                url,
                pinned: false,
                source: "local".into(),
                labels: vec![],
                color: new_color(store)?,
            });
            Ok(true)
        })
    }
    pub fn set_pin(&self, request: PinRequest) -> Result<CatalogSnapshot> {
        if request.id.len() > MAX_NAME {
            return Err(CatalogError::InvalidInput);
        }
        self.change(|store| {
            let pin = if let Some(c) = store.clusters.iter_mut().find(|c| c.id == request.id) {
                &mut c.pinned
            } else if let Some(l) = store.web_links.iter_mut().find(|l| l.id == request.id) {
                &mut l.pinned
            } else {
                return Err(CatalogError::NotFound);
            };
            let changed = *pin != request.pinned;
            *pin = request.pinned;
            Ok(changed)
        })
    }
    pub fn remove(&self, request: RemoveRequest) -> Result<CatalogSnapshot> {
        if request.id.len() > MAX_NAME {
            return Err(CatalogError::InvalidInput);
        }
        self.change(|store| {
            let count = store.clusters.len() + store.web_links.len();
            store.clusters.retain(|c| c.id != request.id);
            store.web_links.retain(|l| l.id != request.id);
            if count == store.clusters.len() + store.web_links.len() {
                return Err(CatalogError::NotFound);
            }
            Ok(true)
        })
    }
}
fn source_label(source: &str, home: Option<&Path>) -> String {
    if home.is_some_and(|home| {
        let default = home.join(".kube/config");
        Path::new(source) == default
    }) {
        "file=~/.kube/config".into()
    } else {
        format!("file={source}")
    }
}
fn valid_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}
fn new_color(store: &Store) -> Result<String> {
    color_with(store, |bytes| {
        getrandom::fill(bytes).map_err(|_| CatalogError::StoreUnavailable)
    })
}
fn color_with(store: &Store, mut fill: impl FnMut(&mut [u8]) -> Result<()>) -> Result<String> {
    for _ in 0..128 {
        let mut bytes = [0; 3];
        fill(&mut bytes)?;
        let color = format!("#{:02X}{:02X}{:02X}", bytes[0], bytes[1], bytes[2]);
        if !store.clusters.iter().any(|c| c.color == color)
            && !store.web_links.iter().any(|c| c.color == color)
        {
            return Ok(color);
        }
    }
    Err(CatalogError::StoreUnavailable)
}
fn discover_default(store: &mut Store, input: &Path) -> Result<bool> {
    match fs::symlink_metadata(input) {
        Ok(_) => reconcile(store, input),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if store
                .clusters
                .iter()
                .any(|c| Path::new(&c.provenance_path) == input)
            {
                return Err(CatalogError::InputUnavailable);
            }
            // A missing default is normal; a broken directory alias or denied
            // ancestor is not. Inspect only ancestors of this one default path.
            for ancestor in input.ancestors().skip(1) {
                match fs::symlink_metadata(ancestor) {
                    Ok(_) => {
                        return match fs::metadata(ancestor) {
                            Ok(metadata) if metadata.is_dir() => Ok(false),
                            _ => Err(CatalogError::InputUnavailable),
                        };
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => return Err(CatalogError::InputUnavailable),
                }
            }
            Ok(false)
        }
        Err(_) => Err(CatalogError::InputUnavailable),
    }
}
fn reconcile(store: &mut Store, input: &Path) -> Result<bool> {
    // Resolve first, then open only the canonical target. Storage reads deliberately
    // keep using bounded_read without resolution so storage symlinks stay rejected.
    let alias = input
        .to_str()
        .filter(|path| valid_source_path(path))
        .ok_or(CatalogError::InvalidInput)?;
    let path = fs::canonicalize(input).map_err(|_| CatalogError::InputUnavailable)?;
    let source = path
        .to_str()
        .filter(|p| p.len() <= MAX_PATH)
        .ok_or(CatalogError::InvalidInput)?
        .to_owned();
    if !path
        .file_name()
        .and_then(|s| s.to_str())
        .is_some_and(valid_name)
    {
        return Err(CatalogError::InvalidInput);
    }
    let bytes = bounded_read(&path, MAX_INPUT)?;
    let contexts = parse_metadata(&bytes)?;
    // Stage reconciliation so a rejected discovery never removes the last valid rows.
    let mut staged = store.clone();
    let mut next = Vec::new();
    for context in contexts {
        let id = cluster_id(&source, &context);
        let previous = store.clusters.iter().find(|c| c.id == id);
        let color = match previous {
            Some(c) => c.color.clone(),
            None => new_color(&staged)?,
        };
        let record = ClusterRecord {
            id,
            context_name: context,
            source_path: source.clone(),
            provenance_path: alias.to_owned(),
            pinned: previous.is_some_and(|c| c.pinned),
            color,
        };
        staged.clusters.push(record.clone());
        next.push(record);
    }
    // One provenance alias per canonical source: the last successful import wins.
    // Retargeting removes rows still owned by that alias, not independently selected
    // sources. A direct reimport can therefore deliberately retain the old target.
    staged
        .clusters
        .retain(|c| c.source_path != source && c.provenance_path != alias);
    staged.clusters.extend(next);
    staged.clusters.sort_by(|a, b| a.id.cmp(&b.id));
    storage::validate_size(&staged)?;
    let changed = serde_json::to_vec(&store.clusters)
        .map_err(|_| CatalogError::StoreUnavailable)?
        != serde_json::to_vec(&staged.clusters).map_err(|_| CatalogError::StoreUnavailable)?;
    *store = staged;
    Ok(changed)
}
fn valid_source_path(source: &str) -> bool {
    let path = Path::new(source);
    source.len() <= MAX_PATH
        && !source.chars().any(char::is_control)
        && path.is_absolute()
        && path
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(valid_name)
}
fn valid_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_NAME && s.trim() == s && !s.chars().any(char::is_control)
}
fn cluster_id(source: &str, context: &str) -> String {
    digest_id("cluster", &[source, context])
}
fn link_id(url: &str) -> String {
    digest_id("link", &[url])
}
fn digest_id(kind: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part.as_bytes());
    }
    format!("{kind}-{:x}", hash.finalize())
}
fn normalize_url(value: &str) -> Result<String> {
    if value.len() > MAX_URL
        || value.trim() != value
        || value.chars().any(char::is_control)
        || value.contains('\\')
    {
        return Err(CatalogError::InvalidInput);
    }
    let url = url::Url::parse(value).map_err(|_| CatalogError::InvalidInput)?;
    // Query and fragment can carry credentials; this catalog never stores them.
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || value
            .split("://")
            .nth(1)
            .is_some_and(|s| s.split('/').next().is_some_and(|a| a.contains('@')))
    {
        return Err(CatalogError::InvalidInput);
    }
    let normalized = url.to_string();
    if normalized.len() > MAX_URL {
        return Err(CatalogError::InvalidInput);
    }
    Ok(normalized)
}
pub(crate) fn bounded_read(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|_| CatalogError::InputUnavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CatalogError::InputUnavailable);
    }
    if metadata.len() > limit as u64 {
        return Err(CatalogError::LimitExceeded);
    }
    let file = File::open(path).map_err(|_| CatalogError::InputUnavailable)?;
    let opened = file
        .metadata()
        .map_err(|_| CatalogError::InputUnavailable)?;
    if !opened.is_file() || !same_file(&metadata, &opened) {
        return Err(CatalogError::InputUnavailable);
    }
    if opened.len() > limit as u64 {
        return Err(CatalogError::LimitExceeded);
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CatalogError::InputUnavailable)?;
    if bytes.len() > limit {
        return Err(CatalogError::LimitExceeded);
    }
    Ok(bytes)
}
// Best-effort replacement detection, not a hostile-filesystem race guarantee.
fn same_file(before: &fs::Metadata, opened: &fs::Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        before.dev() == opened.dev() && before.ino() == opened.ino()
    }
    #[cfg(not(unix))]
    {
        before.len() == opened.len() && before.modified().ok() == opened.modified().ok()
    }
}
#[derive(Deserialize)]
struct KubeMetadata {
    #[serde(rename = "apiVersion")]
    api_version: String,
    kind: String,
    clusters: Vec<NamedCluster>,
    contexts: Vec<NamedContext>,
}
#[derive(Deserialize)]
struct NamedCluster {
    name: String,
}
#[derive(Deserialize)]
struct NamedContext {
    name: String,
    context: ContextMetadata,
}
#[derive(Deserialize)]
struct ContextMetadata {
    cluster: String,
}
fn parse_metadata(bytes: &[u8]) -> Result<Vec<String>> {
    // Unknown fields (including users, exec, and certificates) are skipped by Serde.
    let config: KubeMetadata =
        serde_yaml_ng::from_slice(bytes).map_err(|_| CatalogError::InvalidKubeconfig)?;
    if config.api_version != "v1" || config.kind != "Config" {
        return Err(CatalogError::InvalidKubeconfig);
    }
    if config.clusters.len() > MAX_ENTRIES || config.contexts.len() > MAX_ENTRIES {
        return Err(CatalogError::LimitExceeded);
    }
    let mut clusters = HashSet::new();
    for cluster in config.clusters {
        if !valid_name(&cluster.name) || !clusters.insert(cluster.name) {
            return Err(CatalogError::InvalidKubeconfig);
        }
    }
    let mut names = HashSet::new();
    for context in config.contexts {
        if !valid_name(&context.name)
            || !clusters.contains(&context.context.cluster)
            || !names.insert(context.name)
        {
            return Err(CatalogError::InvalidKubeconfig);
        }
    }
    let mut names: Vec<_> = names.into_iter().collect();
    names.sort();
    Ok(names)
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod discovery_tests;

#[cfg(test)]
mod symlink_tests;

#[cfg(test)]
mod open_tests;
