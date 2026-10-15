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

const MAX_RESPONSE_BYTES: u64 = 16 * 1024;
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
        backend.request("initialize", Some(app_data))?;
        Ok(backend)
    }

    pub fn status(&mut self) -> Result<BackendStatus, String> {
        self.request("status", None)
    }

    fn request(&mut self, method: &str, app_data: Option<&Path>) -> Result<BackendStatus, String> {
        let result = self.exchange(method, app_data);
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn exchange(&mut self, method: &str, app_data: Option<&Path>) -> Result<BackendStatus, String> {
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
        if let Some(error) = response.get("error") {
            return Err(format!("Backend rejected request: {error}"));
        }
        let status: BackendStatus = serde_json::from_value(response["result"].clone())
            .map_err(|error| format!("Invalid backend status: {error}"))?;
        validate_status(&status, self.child.id())?;
        Ok(status)
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
