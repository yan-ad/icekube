//! Catalog workflow reference: Freelens v1.10.3-533, cd07118f843c4a69f937a319a37a7c12ef2c92d8,
//! common/catalog/catalog-entity.ts and common/catalog-entities/web-link.ts (behavior only).
//! CatalogEngine owns imported disconnected contexts, local links, and entry-only pins.
//! Snapshot results cover empty/loaded states; sanitized errors cover rejected/unavailable states.
//! Acceptance fixtures live in catalog/tests.rs; connecting and opening links are not implemented.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::{Read, Write},
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
}
type Result<T> = std::result::Result<T, CatalogError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    pub revision: u64,
    pub clusters: Vec<ClusterSummary>,
    pub web_links: Vec<WebLinkSummary>,
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
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebLinkSummary {
    pub id: String,
    pub name: String,
    pub url: String,
    pub pinned: bool,
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

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Store {
    schema_version: u32,
    revision: u64,
    clusters: Vec<ClusterRecord>,
    web_links: Vec<WebLinkSummary>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClusterRecord {
    id: String,
    context_name: String,
    source_path: String,
    pinned: bool,
}
impl Store {
    fn empty() -> Self {
        Self {
            schema_version: 1,
            ..Self::default()
        }
    }
    fn snapshot(&self) -> CatalogSnapshot {
        let mut clusters: Vec<_> = self
            .clusters
            .iter()
            .map(|c| ClusterSummary {
                id: c.id.clone(),
                name: c.context_name.clone(),
                context_name: c.context_name.clone(),
                source: Path::new(&c.source_path)
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default()
                    .to_owned(),
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
        }
    }
    fn validate(&self) -> Result<()> {
        if self.schema_version != 1 || self.clusters.len() + self.web_links.len() > MAX_ENTRIES {
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
                || c.id != cluster_id(&c.source_path, &c.context_name)
                || !ids.insert(&c.id)
            {
                return Err(CatalogError::StoreCorrupt);
            }
        }
        for l in &self.web_links {
            if !valid_name(&l.name)
                || normalize_url(&l.url).ok().as_ref() != Some(&l.url)
                || l.id != link_id(&l.url)
                || !ids.insert(&l.id)
                || !urls.insert(&l.url)
            {
                return Err(CatalogError::StoreCorrupt);
            }
        }
        Ok(())
    }
}

// No source files are read until an explicit import. The mutex serializes read/modify/replace.
pub struct CatalogEngine {
    directory: PathBuf,
    operations: Mutex<()>,
}
impl CatalogEngine {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            operations: Mutex::new(()),
        }
    }
    pub fn list(&self) -> Result<CatalogSnapshot> {
        let _guard = self
            .operations
            .lock()
            .map_err(|_| CatalogError::StoreUnavailable)?;
        Ok(self.load()?.snapshot())
    }
    fn load(&self) -> Result<Store> {
        match fs::symlink_metadata(&self.directory) {
            Ok(m) if !m.is_dir() || m.file_type().is_symlink() => {
                return Err(CatalogError::StoreUnavailable);
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Store::empty()),
            Err(_) => return Err(CatalogError::StoreUnavailable),
        }
        let path = self.directory.join("catalog.json");
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Store::empty()),
            Err(_) => return Err(CatalogError::StoreUnavailable),
            Ok(m) if !m.is_file() || m.file_type().is_symlink() => {
                return Err(CatalogError::StoreCorrupt);
            }
            Ok(_) => {}
        }
        let bytes = bounded_read(&path, MAX_STORE).map_err(|_| CatalogError::StoreCorrupt)?;
        let store: Store =
            serde_json::from_slice(&bytes).map_err(|_| CatalogError::StoreCorrupt)?;
        store.validate()?;
        Ok(store)
    }
    fn save(&self, store: &Store) -> Result<()> {
        store.validate()?;
        let bytes = serde_json::to_vec(store).map_err(|_| CatalogError::StoreUnavailable)?;
        if bytes.len() > MAX_STORE {
            return Err(CatalogError::LimitExceeded);
        }
        fs::create_dir_all(&self.directory).map_err(|_| CatalogError::StoreUnavailable)?;
        let metadata =
            fs::symlink_metadata(&self.directory).map_err(|_| CatalogError::StoreUnavailable)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(CatalogError::StoreUnavailable);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| CatalogError::StoreUnavailable)?;
        }
        let mut temp = tempfile::NamedTempFile::new_in(&self.directory)
            .map_err(|_| CatalogError::StoreUnavailable)?;
        temp.write_all(&bytes)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|_| CatalogError::StoreUnavailable)?;
        // persist uses platform replacement semantics, including MoveFileEx on Windows.
        temp.persist(self.directory.join("catalog.json"))
            .map_err(|_| CatalogError::StoreUnavailable)?;
        Ok(())
    }
    fn change(&self, update: impl FnOnce(&mut Store) -> Result<bool>) -> Result<CatalogSnapshot> {
        let _guard = self
            .operations
            .lock()
            .map_err(|_| CatalogError::StoreUnavailable)?;
        let mut store = self.load()?;
        if update(&mut store)? {
            store.revision = store
                .revision
                .checked_add(1)
                .ok_or(CatalogError::LimitExceeded)?;
            if store.clusters.len() + store.web_links.len() > MAX_ENTRIES {
                return Err(CatalogError::LimitExceeded);
            }
            self.save(&store)?;
        }
        Ok(store.snapshot())
    }
    pub fn import_kubeconfig(&self, request: ImportRequest) -> Result<CatalogSnapshot> {
        if request.path.is_empty()
            || request.path.len() > MAX_PATH
            || request.path.contains('\0')
            || !Path::new(&request.path).is_absolute()
        {
            return Err(CatalogError::InvalidInput);
        }
        // Read and parse under the operation lock so concurrent imports cannot reorder updates.
        self.change(|store| {
            let path =
                fs::canonicalize(&request.path).map_err(|_| CatalogError::InputUnavailable)?;
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
            let bytes = bounded_read(Path::new(&request.path), MAX_INPUT)?;
            let contexts = parse_metadata(&bytes)?;
            let mut next = Vec::new();
            for context in contexts {
                let id = cluster_id(&source, &context);
                let pinned = store.clusters.iter().any(|c| c.id == id && c.pinned);
                next.push(ClusterRecord {
                    id,
                    context_name: context,
                    source_path: source.clone(),
                    pinned,
                });
            }
            let before =
                serde_json::to_vec(&store.clusters).map_err(|_| CatalogError::StoreUnavailable)?;
            store.clusters.retain(|c| c.source_path != source);
            store.clusters.extend(next);
            store.clusters.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(before
                != serde_json::to_vec(&store.clusters)
                    .map_err(|_| CatalogError::StoreUnavailable)?)
        })
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
fn bounded_read(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path).map_err(|_| CatalogError::InputUnavailable)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(CatalogError::InputUnavailable);
    }
    if metadata.len() > limit as u64 {
        return Err(CatalogError::LimitExceeded);
    }
    let file = File::open(path).map_err(|_| CatalogError::InputUnavailable)?;
    if !file
        .metadata()
        .map_err(|_| CatalogError::InputUnavailable)?
        .is_file()
    {
        return Err(CatalogError::InputUnavailable);
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
