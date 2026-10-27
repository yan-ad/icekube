# Unsigned prereleases

The first prerelease is `0.0.1-pre.1`, without a `v` prefix. The repository is
[yan-ad/icekube](https://github.com/yan-ad/icekube). This route does not require
Apple Developer credentials or Tauri updater signing secrets.

## Checks and publication

`.github/workflows/ci.yml` runs on pushes to `super`, pull requests, manual runs,
and reusable workflow calls. Rust formatting, locked tests and Clippy run on
`macos-15` and `ubuntu-24.04`. Frontend builds and Chromium fixture tests run on
Ubuntu in four test-level shards, with two browser workers per shard. Tests use
fixtures and mocked IPC, not a real cluster or kubeconfig. All tests remain in the
release gate; this is not a reduced smoke suite.

The Linux Rust job exports the real 41-kind detail contract as a same-commit
artifact. Browser shards consume that artifact rather than compiling Rust or
installing native GTK/WebKit build dependencies. A missing or mismatched artifact
fails the contract test. Local runs can still generate the contract using Cargo.

Each shard emits test-by-test progress and a blob report, retains failure traces,
and has an eight-minute Playwright deadline inside a ten-minute Actions test-step
limit. Setup steps are separately bounded and the entire shard job is limited to
20 minutes. These are failure ceilings, not promised execution times. The four
shards currently contain 166, 166, 166 and 165 tests, without omissions or duplicates.

`.github/workflows/prerelease-unsigned.yml` runs on tag pushes matching
`*-pre.*`. It reuses the full CI workflow, then requires canonical
`X.Y.Z-pre.N` tags, matching application manifest/lock versions, and an exact
checked-out tag commit. `0.0.1-pre.1` is accepted; `v0.0.1-pre.1` is not.

After those checks, an ARM64 `macos-15` runner builds an Apple Silicon DMG with
Cargo `--locked` and frozen Bun dependencies. `.github/release-unsigned.json`
uses macOS ad-hoc signing (`-`), disables updater artifact generation, and clears
the updater public key and endpoints. No Apple or updater signing secrets are
passed to the build; notarization is skipped. Ad-hoc signing is not Developer ID
signing or Apple notarization. The existing Rust updater fails closed when the
public key is empty, so automatic updates remain disabled.

The job verifies the app's ad-hoc signature, architecture and version, verifies
the DMG, and generates `SHASUMS256.txt`. It creates an exact-tag draft containing
only the DMG and checksum file, downloads and checks those uploaded files, then
publishes it as a **prerelease**, explicitly **not latest**. GitHub also provides
its normal source archives. A failure before publication can leave a draft.
There is no `latest.json`, updater archive or updater signature.

Publication is automatic after an authorized operator pushes the reviewed
release commit and exact tag. This document does not itself create commits or
tags. Do not retarget or force-push a published tag. The workflow refuses to
clobber an existing release; inspect a failed draft before deciding how to recover.
Source changes after publication require a new version and tag.

## Install on an Apple Silicon Mac

1. Download the DMG and `SHASUMS256.txt` from the
   [exact prerelease](https://github.com/yan-ad/icekube/releases/tag/0.0.1-pre.1).
   In their download directory, run:

   ```sh
   shasum -a 256 -c SHASUMS256.txt
   ```

   A matching checksum detects corruption. It does not authenticate the publisher.
2. Open the DMG and drag `IceKube.app` to `/Applications`.
3. macOS may block this non-notarized app. **Only if you trust this repository and
   this downloaded release**, remove quarantine from this installed app and open it:

   ```sh
   xattr -dr com.apple.quarantine /Applications/IceKube.app
   open /Applications/IceKube.app
   ```

Do not disable Gatekeeper globally or remove quarantine from an untrusted download.
No Intel, Universal, Linux or Windows installer is published by this workflow.
This is an early prerelease; connect only to clusters and credentials you intend
the app to use. Gatekeeper behavior and installation still require a real
Apple Silicon Mac smoke test; CI bundle checks are not that smoke test.

## Signed stable releases

The existing [signed release instructions](releasing.md) and `release.yml` remain
separate. Their `v*` trigger excludes hyphenated prerelease tags, their manifest
validation accepts only stable versions, and Apple/updater signing secrets remain
mandatory. Do not use `cargo xtask release` for unsigned prereleases: that tool
intentionally accepts only stable versions and creates `vX.Y.Z` tags. Returning
from the current prerelease manifests to the signed-stable route requires a
reviewed stable-version update before using that stable-only tooling.
