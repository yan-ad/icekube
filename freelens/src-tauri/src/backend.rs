// Copyright (c) Freelens Authors. All rights reserved.
// Licensed under MIT License. See LICENSE in root directory for more information.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};

const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackendStatus {
    pub protocol_version: u32,
    pub runtime: String,
    pub node_version: String,
    pub process_id: u32,
    pub user_data: String,
    pub session_data: String,
    pub phases: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSnapshot {
    pub protocol_version: u32,
    pub scope: String,
    pub categories: Vec<CatalogCategory>,
    pub entities: Vec<CatalogEntity>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogCategory {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub group: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogEntity {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub group: String,
    pub source: String,
    pub status: String,
    pub labels: std::collections::BTreeMap<String, String>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub icon: Option<CatalogIcon>,
    #[serde(deserialize_with = "Option::deserialize")]
    pub action: Option<CatalogAction>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogIcon {
    pub material: String,
    pub background: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum CatalogAction {
    Welcome,
    Catalog,
}

fn bounded_text(value: &str) -> bool {
    !value.is_empty() && value.encode_utf16().count() <= 4096
}

fn validate_catalog(snapshot: &CatalogSnapshot) -> Result<(), String> {
    let mut category_ids = std::collections::HashSet::new();
    let mut entity_ids = std::collections::HashSet::new();
    if snapshot.protocol_version != 2
        || snapshot.scope != "local"
        || snapshot.categories.len() > 32
        || snapshot.entities.len() > 1000
        || snapshot.warnings.len() > 256
        || snapshot
            .warnings
            .iter()
            .any(|warning| !bounded_text(warning))
        || snapshot.categories.iter().any(|category| {
            category.id != format!("{}/{}", category.group, category.kind)
                || [
                    &category.id,
                    &category.name,
                    &category.group,
                    &category.kind,
                    &category.icon,
                ]
                .iter()
                .any(|s| !bounded_text(s))
                || !["settings", "kubernetes", "public"].contains(&category.icon.as_str())
                || !category_ids.insert(&category.id)
        })
        || snapshot.entities.iter().any(|entity| {
            [
                &entity.id,
                &entity.name,
                &entity.kind,
                &entity.group,
                &entity.source,
                &entity.status,
            ]
            .iter()
            .any(|s| !bounded_text(s))
                || entity.action.as_ref().is_some_and(|action| {
                    entity.group != "entity.k8slens.dev"
                        || entity.kind != "General"
                        || entity.source != "app"
                        || entity.id
                            != match action {
                                CatalogAction::Welcome => "welcome-page-entity",
                                CatalogAction::Catalog => "catalog-entity",
                            }
                })
                || entity.labels.len() > 256
                || entity.labels.iter().any(|(key, value)| {
                    key.is_empty()
                        || key.encode_utf16().count() > 256
                        || value.encode_utf16().count() > 4096
                })
                || entity.icon.as_ref().is_some_and(|icon| {
                    !bounded_text(&icon.material) || !bounded_text(&icon.background)
                })
                || !entity_ids.insert(&entity.id)
                || !snapshot
                    .categories
                    .iter()
                    .any(|category| category.group == entity.group && category.kind == entity.kind)
        })
    {
        return Err("Backend catalog snapshot mismatch".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node_paths() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        (
            std::env::var_os("FREELENS_TAURI_NODE").unwrap().into(),
            std::env::var_os("FREELENS_TAURI_BACKEND").unwrap().into(),
            std::env::var_os("FREELENS_TAURI_PROFILE").unwrap().into(),
        )
    }

    #[test]
    fn real_node_backend_is_owned_and_stopped() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let status = backend.status().unwrap();
        assert_eq!(status.process_id, backend.child.id());
        assert_eq!(Path::new(&status.user_data), profile.join("Freelens"));
        assert!(!profile.exists());
        backend.stop();
        assert!(backend.child.try_wait().unwrap().unwrap().success());
        assert!(backend.status().is_err());
        backend.stop();
    }

    #[test]
    fn real_catalog_and_strict_schema_validation() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let snapshot = backend.catalog_snapshot().unwrap();
        assert_eq!(snapshot.protocol_version, 2);
        assert_eq!(snapshot.scope, "local");
        assert!(snapshot.warnings.is_empty());
        assert_eq!(snapshot.categories.len(), 3);
        assert_eq!(
            snapshot.categories[1].id,
            "entity.k8slens.dev/KubernetesCluster"
        );
        assert_eq!(snapshot.categories[1].icon, "kubernetes");
        assert_eq!(snapshot.categories[2].id, "entity.k8slens.dev/WebLink");
        assert_eq!(snapshot.categories[0].id, "entity.k8slens.dev/General");
        assert!(snapshot.entities.len() >= 3);
        let welcome = snapshot
            .entities
            .iter()
            .find(|entity| entity.id == "welcome-page-entity")
            .unwrap();
        let catalog = snapshot
            .entities
            .iter()
            .find(|entity| entity.id == "catalog-entity")
            .unwrap();
        let preferences = snapshot
            .entities
            .iter()
            .find(|entity| entity.id == "preferences-entity")
            .unwrap();
        assert_eq!(welcome.action, Some(CatalogAction::Welcome));
        assert_eq!(catalog.action, Some(CatalogAction::Catalog));
        assert_eq!(preferences.action, None);
        assert!(snapshot
            .entities
            .iter()
            .filter(|entity| entity.kind == "General")
            .all(|entity| entity.source == "app"
                && entity.status == "active"
                && entity.labels.is_empty()));
        assert!(snapshot
            .entities
            .iter()
            .filter(|entity| entity.kind == "KubernetesCluster")
            .all(|entity| entity.source == "local" && entity.status == "disconnected"));
        assert!(!profile.exists());
        let value = serde_json::to_value(&snapshot).unwrap();
        for location in ["root", "category", "entity"] {
            let mut invalid = value.clone();
            let target = match location {
                "category" => &mut invalid["categories"][0],
                "entity" => &mut invalid["entities"][0],
                _ => &mut invalid,
            };
            target["unknown"] = json!(true);
            assert!(serde_json::from_value::<CatalogSnapshot>(invalid).is_err());
        }
        for field in ["icon", "action"] {
            let mut invalid = value.clone();
            invalid["entities"][0]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(serde_json::from_value::<CatalogSnapshot>(invalid).is_err());
        }
        let mut invalid_enum = value.clone();
        invalid_enum["entities"][0]["action"] = json!("execute");
        assert!(serde_json::from_value::<CatalogSnapshot>(invalid_enum).is_err());
        let mut invalid_length = snapshot.clone();
        invalid_length.entities[0].name = "x".repeat(4097);
        assert!(validate_catalog(&invalid_length).is_err());
        let mut invalid_warnings = snapshot.clone();
        invalid_warnings.warnings = vec!["warning".into(); 257];
        assert!(validate_catalog(&invalid_warnings).is_err());
        let mut invalid = snapshot.clone();
        invalid.entities = vec![snapshot.entities[0].clone(); 1001];
        assert!(validate_catalog(&invalid).is_err());
        invalid = snapshot.clone();
        invalid.categories = vec![snapshot.categories[0].clone(); 33];
        assert!(validate_catalog(&invalid).is_err());
        invalid = snapshot.clone();
        invalid.entities[0].kind = "NoSuchCategory".into();
        assert!(validate_catalog(&invalid).is_err());
        invalid = snapshot.clone();
        invalid.entities[0].status.clear();
        assert!(validate_catalog(&invalid).is_err());
        let mut invalid = value;
        invalid["entities"][0]["status"] = json!({"phase": "active"});
        assert!(serde_json::from_value::<CatalogSnapshot>(invalid).is_err());
    }

    #[test]
    fn invalid_catalog_response_is_terminal() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let (sender, responses) = mpsc::sync_channel(1);
        sender.send(Ok(json!({ "id": 2, "result": { "protocolVersion": 1, "scope": "built-in", "categories": [], "entities": [], "unknown": true } }))).unwrap();
        backend.responses = responses;
        assert!(backend.catalog_snapshot().is_err());
        assert!(backend.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn catalog_rejection_is_recoverable_and_preserves_response_sequence() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let (sender, responses) = mpsc::sync_channel(1);
        sender
            .send(Ok(json!({ "id": 2, "error": "Snapshot unavailable" })))
            .unwrap();
        let real_responses = std::mem::replace(&mut backend.responses, responses);
        assert_eq!(
            backend.catalog_snapshot().unwrap_err(),
            "Backend rejected request"
        );
        assert!(backend.child.try_wait().unwrap().is_none());
        // The injected rejection substitutes for request 2. Drain its real reply
        // before restoring the transport, so request 3 must match a fresh response.
        let real_reply = real_responses
            .recv_timeout(RESPONSE_TIMEOUT)
            .unwrap()
            .unwrap();
        assert_eq!(real_reply["id"], 2);
        backend.responses = real_responses;
        assert_eq!(backend.status().unwrap().process_id, backend.child.id());
        assert!(backend.catalog_snapshot().is_ok());
    }

    #[test]
    fn malformed_catalog_error_envelopes_are_terminal() {
        for response in [
            json!({ "id": 2, "error": "unavailable", "result": null }),
            json!({ "id": 2, "error": "unavailable", "extra": true }),
            json!({ "id": 2, "error": null }),
            json!({ "id": 2, "error": { "message": "synthetic-secret" } }),
            json!({ "id": 2, "error": "" }),
            json!({ "id": 2, "error": "x".repeat(4097) }),
            json!({ "id": 999, "error": "unavailable" }),
        ] {
            let (node, script, profile) = node_paths();
            let mut backend = Backend::start(&node, &script, &profile).unwrap();
            let (sender, responses) = mpsc::sync_channel(1);
            sender.send(Ok(response)).unwrap();
            backend.responses = responses;
            let error = backend.catalog_snapshot().unwrap_err();
            assert!(!error.contains("synthetic-secret"));
            assert!(backend.child.try_wait().unwrap().is_some());
        }
    }

    #[test]
    fn status_rejection_remains_terminal() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let (sender, responses) = mpsc::sync_channel(1);
        sender
            .send(Ok(json!({ "id": 2, "error": "Status unavailable" })))
            .unwrap();
        backend.responses = responses;
        assert!(backend.status().is_err());
        assert!(backend.child.try_wait().unwrap().is_some());
    }

    #[test]
    fn wrong_version_process_or_profile_is_rejected() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let status = backend.status().unwrap();
        let mut invalid = status.clone();
        invalid.protocol_version = 2;
        assert!(validate_status(&invalid, status.process_id).is_err());
        assert!(validate_status(&status, status.process_id + 1).is_err());
        invalid = status.clone();
        invalid.session_data = "different".into();
        assert!(validate_status(&invalid, status.process_id).is_err());
    }

    #[test]
    fn relative_launch_paths_are_rejected() {
        assert!(Backend::start(
            Path::new("node"),
            Path::new("backend.mjs"),
            Path::new("profile")
        )
        .is_err());
    }

    #[test]
    fn timeout_is_terminal_and_reaps_the_backend() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let (_sender, responses) = mpsc::sync_channel(1);
        backend.responses = responses;
        backend.response_timeout = Duration::from_millis(10);
        assert!(backend
            .status()
            .unwrap_err()
            .contains("response unavailable"));
        assert!(backend.child.try_wait().unwrap().is_some());
        assert!(backend.status().is_err());
    }

    #[test]
    fn mismatched_response_is_terminal_and_reaps_the_backend() {
        let (node, script, profile) = node_paths();
        let mut backend = Backend::start(&node, &script, &profile).unwrap();
        let (sender, responses) = mpsc::sync_channel(1);
        sender.send(Ok(json!({ "id": 999 }))).unwrap();
        backend.responses = responses;
        assert!(backend.status().unwrap_err().contains("ID mismatch"));
        assert!(backend.child.try_wait().unwrap().is_some());
    }
}

fn validate_status(status: &BackendStatus, process_id: u32) -> Result<(), String> {
    if status.protocol_version != 1
        || status.runtime != "node"
        || status.process_id != process_id
        || status.phases
            != [
                "before-anything",
                "before-host-ready",
                "host-ready",
                "application-started",
            ]
        || !Path::new(&status.user_data).is_absolute()
        || status.session_data != status.user_data
    {
        return Err("Backend runtime handshake mismatch".into());
    }
    Ok(())
}

pub struct Backend {
    child: Child,
    input: Option<ChildStdin>,
    responses: Receiver<Result<Value, String>>,
    next_id: u64,
    response_timeout: Duration,
}

impl Backend {
    pub fn start(node: &Path, script: &Path, app_data: &Path) -> Result<Self, String> {
        if !node.is_absolute() || !script.is_absolute() || !app_data.is_absolute() {
            return Err("Node, backend and profile paths must be absolute".into());
        }
        let mut child = Command::new(node)
            .arg(script)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env_remove("ELECTRON_RUN_AS_NODE")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("Cannot start Node backend: {error}"))?;
        let input = child.stdin.take();
        let output = child
            .stdout
            .take()
            .expect("stdout was configured as a pipe");
        let (sender, responses) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut line = Vec::new();
                let result = match reader
                    .by_ref()
                    .take(MAX_RESPONSE_BYTES + 1)
                    .read_until(b'\n', &mut line)
                {
                    Ok(0) => break,
                    Ok(_) if line.len() as u64 > MAX_RESPONSE_BYTES => {
                        Err("Backend response exceeds size limit".into())
                    }
                    Ok(_) if !line.ends_with(b"\n") => {
                        Err("Backend closed with an incomplete response".into())
                    }
                    Ok(_) => serde_json::from_slice(&line)
                        .map_err(|error| format!("Invalid backend response: {error}")),
                    Err(error) => Err(format!("Cannot read backend response: {error}")),
                };
                let failed = result.is_err();
                if sender.send(result).is_err() || failed {
                    break;
                }
            }
        });
        let mut backend = Self {
            child,
            input,
            responses,
            next_id: 1,
            response_timeout: RESPONSE_TIMEOUT,
        };
        backend.request_status("initialize", Some(app_data))?;
        Ok(backend)
    }

    pub fn status(&mut self) -> Result<BackendStatus, String> {
        self.request_status("status", None)
    }

    fn request_status(
        &mut self,
        method: &str,
        app_data: Option<&Path>,
    ) -> Result<BackendStatus, String> {
        let result = self
            .exchange(method, app_data)
            .and_then(|value| value)
            .and_then(|value| {
                let status: BackendStatus = serde_json::from_value(value)
                    .map_err(|error| format!("Invalid backend status: {error}"))?;
                validate_status(&status, self.child.id())?;
                Ok(status)
            });
        if result.is_err() {
            self.stop();
        }
        result
    }

    pub fn catalog_snapshot(&mut self) -> Result<CatalogSnapshot, String> {
        let response = match self.exchange("catalog.snapshot", None) {
            Ok(Ok(value)) => value,
            // A well-formed application rejection does not poison the transport.
            Ok(Err(error)) => return Err(error),
            Err(error) => {
                self.stop();
                return Err(error);
            }
        };
        let result = (|| {
            let value = response;
            let snapshot: CatalogSnapshot = serde_json::from_value(value)
                .map_err(|error| format!("Invalid backend catalog snapshot: {error}"))?;
            validate_catalog(&snapshot)?;
            Ok(snapshot)
        })();
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn exchange(
        &mut self,
        method: &str,
        app_data: Option<&Path>,
    ) -> Result<Result<Value, String>, String> {
        if self
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Err("Node backend has exited".into());
        }
        let id = self.next_id;
        self.next_id += 1;
        let mut request = json!({ "id": id, "method": method });
        if let Some(path) = app_data {
            request["appData"] = json!(path);
        }
        let input = self.input.as_mut().ok_or("Node backend is stopped")?;
        writeln!(input, "{request}").map_err(|error| error.to_string())?;
        input.flush().map_err(|error| error.to_string())?;
        let response = self
            .responses
            .recv_timeout(self.response_timeout)
            .map_err(|error| format!("Backend response unavailable: {error}"))??;
        if response.get("id").and_then(Value::as_u64) != Some(id) {
            return Err("Backend response ID mismatch".into());
        }
        let fields = response
            .as_object()
            .ok_or("Backend response must be an object")?;
        if fields.len() == 2 && fields.contains_key("error") {
            fields["error"]
                .as_str()
                .filter(|error| bounded_text(error))
                .ok_or("Backend response contains an invalid error")?;
            // Do not relay backend exception details or credential-bearing text.
            return Ok(Err("Backend rejected request".into()));
        }
        if fields.len() != 2 || !fields.contains_key("result") {
            return Err("Backend response contains unsupported fields".into());
        }
        Ok(Ok(response["result"].clone()))
    }

    pub fn stop(&mut self) {
        self.input.take();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                _ if Instant::now() >= deadline => break,
                _ => thread::sleep(Duration::from_millis(10)),
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}
