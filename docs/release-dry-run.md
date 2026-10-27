# Release dry run

## Purpose

`.github/workflows/release-dry-run.yml` is a manual packaging rehearsal. It does
not create a tag, bump the current version, create a GitHub Release, publish
packages, or write repository contents. It runs from the exact manually selected
commit and first waits for the full reusable CI workflow.

The stable release target is `0.0.1`. The workflow requires the exact
current commit and synchronized versions in `package.json`, `tauri.conf.json`,
`Cargo.toml` and `Cargo.lock`; it does not alter any of them. It uses read-only
contents permission and no confidential signing or notarization secrets.

## Packaging checks

On an ARM64 macOS runner the workflow:

1. checks out the commit tested by reusable CI and verifies versions and the
   tracked ad-hoc, updater-disabled overlay;
2. installs frozen frontend dependencies and the Rust ARM64 target;
3. builds an Apple Silicon ad-hoc `Iceon.app` without notarization, updater
   artifacts or signing secrets;
4. creates a headless Apple Silicon DMG without Finder or AppleScript;
5. verifies app name, identifier, executable, short version, bundle version,
   architecture, ad-hoc signature, signed resources and absence of `latest.json`,
   signatures and updater archives;
6. verifies the DMG and mounts it read-only, then repeats signature, architecture,
   path, symlink and selected resource comparisons against the audited app;
7. writes only dry-run evidence (`.dmg`, `Info.plist`, `build.json` and checksums)
   and uploads it as a seven-day Actions artifact.

This is static/package verification. It does not launch the app, exercise native
window controls, test Gatekeeper installation, read a real kubeconfig, connect to
a real cluster, or perform native file-picker smoke testing.

## Publication and evidence boundaries

The artifact is an Actions artifact, not a Release asset. On a public repository,
that artifact is not confidential. Retention is seven days. The workflow does not
produce an updater manifest, archive, signature, or `latest.json`, and the tracked
updater key/endpoints are cleared by the unsigned overlay for this build.

Full current validation remains pending until CI is run for the intended commit.
Do not copy historical test counts into a current release claim. The dry-run workflow does not change release versions or create a commit.
See [unsigned stable releases](releases.md) for the separate authorized
publication route.
