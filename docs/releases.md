# Iceon unsigned releases

The next stable unsigned release is **`0.0.2`**, without a `v` prefix, in the existing
[yan-ad/iceon](https://github.com/yan-ad/iceon) repository. The displayed product
is Iceon, packaged as `Iceon.app`; its internal executable stays `iceon` and
its bundle identifier stays `ad.yan.iceon`. No Apple Developer or Tauri updater
signing secrets are required for this route.

Release preparation is pending CI and packaging verification; these instructions
do not claim that 0.0.2 is already published or natively smoke-tested. The
published [0.0.1 release](https://github.com/yan-ad/iceon/releases/tag/0.0.1),
its tag, and its assets remain unchanged. The workflow at that historical tag
retains its original exact-0.0.1 route; the current workflow authorizes only 0.0.2.

## Stable publication gate

`.github/workflows/release-unsigned.yml` runs for the exact `0.0.2` tag push.
It also supports manual dispatch with an optional existing `tag` input. When
using dispatch, select that tag or the same commit as the workflow ref: the tag
commit, checked-out HEAD and Actions `github.sha` must all agree. The reusable
CI checks always run for the Actions commit; a different target tag is rejected.
The route rejects other versions, `v0.0.2`, prereleases, build metadata and
noncanonical versions.
It never creates, moves or force-pushes a tag.

The full `.github/workflows/ci.yml` gates packaging: Rust formatting, locked tests
and Clippy on macOS and Linux, followed by the frontend build and all four Chromium
fixture shards. Browser fixtures consume the real same-commit Rust 41-kind detail
contract. These tests use mocked IPC, not a real kubeconfig or cluster. A failed
or cancelled required check prevents publication.

The release job checks all application manifest versions and the dynamically
resolved local Cargo.lock package against the tag. Product branding is not used
as a Rust package name. It requires the tracked `.github/release-unsigned.json`
overlay: ad-hoc signing (`-`), updater artifacts off, empty updater key and endpoints.
The signed-stable workflow remains separate and still requires all its secrets.

An ARM64 `macos-15` runner installs frozen Bun dependencies and builds only the
Apple Silicon app with Cargo `--locked`. No Apple or updater secrets are passed;
notarization is skipped. The DMG is created with `hdiutil`, without Finder or
AppleScript. Verification covers product name, both version fields, bundle ID,
internal executable, ARM64 architecture, ad-hoc signature and updater absence.
The DMG is verified and mounted read-only. Its app's signature and architecture
are checked, its plist/executable/signed-resource manifest compared against the
built app, and its Applications symlink required to point to `/Applications`.

Only `Iceon_0.0.2_aarch64.dmg` and `SHASUMS256.txt` are uploaded. The workflow
extracts only the matching `## 0.0.2` section from the tracked
[changelog](../CHANGELOG.md) into `/tmp/iceon-release-notes.md`, not an extra
release asset. It creates an exact-tag draft with those notes,
downloads the uploaded files, compares their SHA-256 hashes against the verified
local bytes and checks the checksum file. Only then does it publish with
`draft=false`, `prerelease=false` and mark it latest. GitHub's source archives
are independent. No `latest.json`, updater archive or updater signature is
published. A failed upload/verification can leave a draft; do not overwrite a
published release or retarget a published tag. Fixes require a new version and
a reviewed extension of the exact-tag workflow allowlist.

All jobs default to `contents: read`; only publication has `contents: write`.
The automatic Actions token is not an Apple/updater signing secret. No release
asset URL supplied by an input or remote manifest is used for downloading files.

## Install on Apple Silicon

After publication, download the DMG and `SHASUMS256.txt` from the
[exact stable release](https://github.com/yan-ad/iceon/releases/tag/0.0.2).
Run `shasum -a 256 -c SHASUMS256.txt` in the download directory. A checksum detects
corruption, not publisher identity. Open the DMG and drag `Iceon.app` into
`/Applications`.

This app is **ad-hoc signed, not Developer ID signed or notarized**. macOS may
block it. Only if you trust the repository and this downloaded release:

```sh
xattr -dr com.apple.quarantine /Applications/Iceon.app
open /Applications/Iceon.app
```

Do not disable Gatekeeper globally. Do not remove quarantine from untrusted
downloads. No Intel, Universal, Linux or Windows installer is included. Automatic
updates are disabled. Native installation, Gatekeeper behavior, file pickers,
window controls and live-cluster workflows still require a real Apple Silicon
smoke test; CI bundle checks do not establish those results.

## Other routes

- [Dry run](release-dry-run.md): manual, full-CI packaging rehearsal, read-only
  permissions, seven-day Actions evidence only, no release or tag creation.
- `.github/workflows/prerelease-unsigned.yml`: canonical `X.Y.Z-pre.N` tags without
  `v`, full CI, matching versions and same-commit checkout. Current builds use
  `Iceon.app` and internal `iceon`. It publishes a prerelease, explicitly not
  latest. Historical `0.0.1-pre.2` assets retain their original names; the new
  display name does not rename historical assets or tags.
- [Signed stable route](releasing.md): existing stable `v*` tags and stable-only
  `cargo xtask release` tooling. Developer ID, notarization and updater secrets
  remain mandatory. Do not use that tool for the unsigned `0.0.2` tag.
