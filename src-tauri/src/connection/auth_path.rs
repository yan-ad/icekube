use super::{ConnectionError, Result};
use std::{
    ffi::OsStr,
    path::{Path, PathBuf},
};

const MAX_PATH_BYTES: usize = 32 * 1024;
const MAX_DIRECTORIES: usize = 128;

/// Finder does not inherit the login shell's PATH. Extend only this helper's
/// environment; never execute shell startup files or change the app environment.
pub(super) fn configure(
    env: &mut Vec<(String, String)>,
    inherited: Option<&OsStr>,
    home: Option<&Path>,
) -> Result<()> {
    if env.iter().any(|(name, _)| name == "PATH") {
        return Ok(());
    }
    let mut directories = Vec::new();
    if let Some(path) = inherited {
        if path.len() > MAX_PATH_BYTES {
            return Err(ConnectionError::LimitExceeded);
        }
        for directory in std::env::split_paths(path) {
            add(&mut directories, directory)?;
        }
    }
    for directory in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/opt/homebrew/share/google-cloud-sdk/bin",
        "/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin",
        "/usr/local/share/google-cloud-sdk/bin",
        "/usr/local/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        add(&mut directories, PathBuf::from(directory))?;
    }
    if let Some(home) = home.filter(|path| path.is_absolute()) {
        for directory in ["google-cloud-sdk/bin", ".local/share/google-cloud-sdk/bin"] {
            add(&mut directories, home.join(directory))?;
        }
    }
    let path = std::env::join_paths(directories).map_err(|_| ConnectionError::KubeconfigInvalid)?;
    let path = path
        .into_string()
        .map_err(|_| ConnectionError::KubeconfigInvalid)?;
    if path.len() > MAX_PATH_BYTES {
        return Err(ConnectionError::LimitExceeded);
    }
    env.push(("PATH".into(), path));
    Ok(())
}

fn add(directories: &mut Vec<PathBuf>, directory: PathBuf) -> Result<()> {
    // Empty/relative entries could resolve a helper from an arbitrary working directory.
    if !directory.is_absolute() || directories.contains(&directory) {
        return Ok(());
    }
    if directories.len() >= MAX_DIRECTORIES {
        return Err(ConnectionError::LimitExceeded);
    }
    directories.push(directory);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(env: &[(String, String)]) -> Vec<PathBuf> {
        std::env::split_paths(&env.iter().find(|(name, _)| name == "PATH").unwrap().1).collect()
    }

    #[test]
    fn finder_path_gets_bounded_standard_locations_in_stable_order() {
        let mut env = vec![("SYNTHETIC_AUTH".into(), "unchanged".into())];
        configure(
            &mut env,
            Some(OsStr::new("/usr/bin:/bin")),
            Some(Path::new("/Users/fixture")),
        )
        .unwrap();
        let dirs = path(&env);
        assert_eq!(&dirs[..2], [Path::new("/usr/bin"), Path::new("/bin")]);
        for directory in [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/opt/homebrew/share/google-cloud-sdk/bin",
            "/usr/local/share/google-cloud-sdk/bin",
            "/Users/fixture/google-cloud-sdk/bin",
            "/Users/fixture/.local/share/google-cloud-sdk/bin",
        ] {
            assert!(dirs.contains(&PathBuf::from(directory)), "{directory}");
        }
        assert_eq!(env[0], ("SYNTHETIC_AUTH".into(), "unchanged".into()));
        let before = env.clone();
        configure(&mut env, None, None).unwrap();
        assert_eq!(env, before);
    }

    #[test]
    fn explicit_kubeconfig_path_is_not_rewritten_even_when_empty() {
        for value in ["", "/explicit/only", "relative::/explicit"] {
            let mut env = vec![("PATH".into(), value.into())];
            let before = env.clone();
            configure(
                &mut env,
                Some(OsStr::new("/usr/bin")),
                Some(Path::new("/fixture")),
            )
            .unwrap();
            assert_eq!(env, before);
        }
    }

    #[test]
    fn inherited_path_has_no_cwd_search_duplicates_or_shell_expansion() {
        let mut env = vec![];
        configure(
            &mut env,
            Some(OsStr::new(
                ":.:relative:~/bin:$HOME/bin:/custom/bin:/custom/bin:/usr/bin:",
            )),
            Some(Path::new("relative-home")),
        )
        .unwrap();
        let dirs = path(&env);
        assert_eq!(dirs[0], Path::new("/custom/bin"));
        assert!(dirs.iter().all(|directory| directory.is_absolute()));
        assert_eq!(
            dirs.iter()
                .filter(|directory| **directory == Path::new("/custom/bin"))
                .count(),
            1
        );
        assert!(!env[0].1.contains("$HOME"));
        assert!(!env[0].1.contains('~'));
    }

    #[test]
    fn oversized_environments_fail_without_mutation() {
        for inherited in [
            "x".repeat(MAX_PATH_BYTES + 1),
            (0..MAX_DIRECTORIES + 1)
                .map(|i| format!("/fixture/{i}"))
                .collect::<Vec<_>>()
                .join(":"),
        ] {
            let mut env = vec![];
            assert_eq!(
                configure(&mut env, Some(OsStr::new(&inherited)), None),
                Err(ConnectionError::LimitExceeded)
            );
            assert!(env.is_empty());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn finder_environment_runs_only_fixture_sdk_helper_and_its_sibling_cli() {
        use super::super::{V1, helper_request, run};
        use kube::config::{Cluster, ExecConfig, ExecInteractiveMode};
        use std::{fs, os::unix::fs::PermissionsExt, time::Duration};

        let home = tempfile::tempdir().unwrap();
        let sdk = home.path().join("google-cloud-sdk/bin");
        fs::create_dir_all(&sdk).unwrap();
        // Distinct fixture names ensure the test cannot execute an installed cloud CLI.
        for (name, body) in [
            (
                "iceon-fixture-auth-helper",
                "exec iceon-fixture-cloud-cli \"$@\"",
            ),
            (
                "iceon-fixture-cloud-cli",
                "[ \"$1\" = '--fixture' ] || exit 7\nprintf '%s' '{\"apiVersion\":\"client.authentication.k8s.io/v1\",\"kind\":\"ExecCredential\",\"status\":{\"token\":\"synthetic-output\"}}'",
            ),
        ] {
            let executable = sdk.join(name);
            fs::write(&executable, format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(executable, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut env = vec![];
        configure(
            &mut env,
            Some(OsStr::new("/usr/bin:/bin")),
            Some(home.path()),
        )
        .unwrap();
        let exec = ExecConfig {
            command: Some("iceon-fixture-auth-helper".into()),
            api_version: Some(V1.into()),
            interactive_mode: Some(ExecInteractiveMode::Never),
            args: Some(vec!["--fixture".into()]),
            env: Some(
                env.into_iter()
                    .map(|(name, value)| [("name".into(), name), ("value".into(), value)].into())
                    .collect(),
            ),
            ..Default::default()
        };
        let request = helper_request(&exec, &Cluster::default(), home.path()).unwrap();
        let output = run(request, Duration::from_secs(2)).await.unwrap();
        let response: serde_json::Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(response["status"]["token"], "synthetic-output");
    }
}
