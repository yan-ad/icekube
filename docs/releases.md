# Iceon 0.0.8 releases

The current release route is `.github/workflows/release-unsigned.yml` in
[yan-ad/iceon](https://github.com/yan-ad/iceon). Despite its historical filename,
it now publishes **signed updater artifacts without paid OS signing certificates**.
The application remains Iceon, with executable `iceon` and bundle identifier
`ad.yan.iceon`. The next stable tag is **`0.0.8`**, without a `v` prefix.
Publication requires CI and packaging verification. Native installation/update
smoke checks remain outstanding; configuration is not evidence of those checks.

## Release gate

The workflow accepts only the exact canonical stable `0.0.8` tag. A manual
dispatch selects an existing tag at the same Actions commit. Tag, checkout HEAD
and reusable CI commit must agree. All application manifests and the local
`iceon` Cargo.lock package version must match. It never creates, moves or
force-pushes tags and refuses to reuse an existing release.

Full reusable CI gates both platform packages. It includes Rust formatting,
locked tests and strict Clippy, frontend build and Chromium fixture shards.
Windows additionally compiles all backend targets for `i686-pc-windows-msvc`
before packaging. Fixtures use mocked IPC, not real credentials or clusters.
A failed or cancelled required job prevents publication.

Browser fixtures run in eight Linux shards with two workers per runner and
fully parallel test distribution. Each shard retains the 480-second suite bound,
10-minute test-step bound and 20-minute job bound; dependency installation,
frontend build and Chromium setup are separate steps. Rust exports the shared
detail and related-collection contracts once after its tests, and every browser shard consumes that
same-commit artifact. These are per-browser-job limits, not a total release-time
promise; platform packaging jobs retain their separate 90-minute limits.

The public minisign key is embedded in `src-tauri/tauri.conf.json` with
`requireSignedVersion: true`. The matching private key is configured as the
GitHub Actions `TAURI_SIGNING_PRIVATE_KEY` secret. Do not read, print or commit
that secret or local signing-key material. CI proves key agreement before
packaging, signs canonical artifact names with `--app-version`, then verifies
both signatures and authenticated versions with `cargo xtask verify-update`.
The current route passes an empty updater-key password; it does not require an
Apple Developer ID, notarization account or Windows Authenticode certificate.

## Packages and publication

The matrix builds macOS aarch64 on `macos-15` and Windows 32-bit x86 on
`windows-2022`, with frozen Bun dependencies and locked Cargo dependencies:

- macOS uses `.github/release-autoupdate.json`, ad-hoc application signing and
  signed updater archives. A headless DMG is created with `hdiutil`. Checks cover
  bundle metadata, ARM64 architecture, ad-hoc signature, mounted read-only DMG
  contents and the `/Applications` symlink. Notarization is skipped.
- Windows uses `.github/release-windows.json`, the `i686-pc-windows-msvc` target
  and a current-user NSIS installer. Checks inspect application and installer
  32-bit PE architecture, application version metadata, absent Authenticode
  signatures and the expected updater artifact. Native Windows behavior still
  requires a separate smoke test.

After both builds succeed, the publisher verifies transferred updater artifacts
and assembles exactly these seven public assets:

| Asset | Purpose |
| --- | --- |
| `Iceon_0.0.8_aarch64.dmg` | First/manual Apple Silicon installation |
| `Iceon_0.0.8_aarch64.app.tar.gz` | macOS app-bundle updater package |
| `Iceon_0.0.8_aarch64.app.tar.gz.sig` | Version-bound minisign signature |
| `Iceon_0.0.8_x86-setup.exe` | First/manual Windows x86 installer and updater package |
| `Iceon_0.0.8_x86-setup.exe.sig` | Version-bound minisign signature |
| `latest.json` | Stable feed for `darwin-aarch64` and `windows-i686` |
| `SHASUMS256.txt` | SHA-256 checksums of the other six assets |

The publisher extracts only the matching canonical `## 0.0.8` changelog section
(optionally suffixed ` (pending CI)`) into release notes. It creates a fresh
exact-tag draft, uploads the assets, audits GitHub asset names/sizes/digests,
downloads them again and compares bytes and checksums. It rechecks updater
signatures and versions before publishing as stable/latest and confirms the
latest release identity. GitHub-generated source archives are separate.
Only publication receives `contents: write`; other jobs default to read access.

Checksums and GitHub digests validate transfer integrity, not update authority.
The application trusts the embedded key, package signature and authenticated
version. See [automatic updates](automatic-updates.md) for runtime checks.
Do not retarget a published tag, replace its assets or mark an older version
latest. Source fixes need a new version and a reviewed workflow allowlist change.
A failed publication may leave a draft; inspect the failure rather than clobber it.

### Unpublished 0.0.8 retry

On 2026-10-30 the maintainer explicitly approved replacing the failed,
**unpublished** 0.0.8 tag after validated source fixes. The original annotated tag
object is `6cc017aa1a821501b56bf75bd3be5600e626b0eb`, peeled commit
`97b1d95c731bfecdaf25a3c184c286b232e690b9`. Failed release run `41003035257`
stopped at browser CI; repository release enumeration contained no 0.0.8 release,
draft or assets. Required fixes include stale fixture IPC/selector expectations,
source-import harnesses, and a same-commit Rust collection-contract artifact for
frontend runners without native build libraries.

This approval is limited to the failed unpublished tag. Before updating it,
recheck its exact remote object and all releases (including drafts). Stop if
published assets, a release or a different tag object exists. Push the validated
source commit first and replace the tag with an exact old-object lease, not a
blind force push or delete/recreate sequence. The replacement must run the full
same-commit CI and normal signed-artifact publication gates. Never reuse an
already published version or bypass failed checks.


## First installation

Working 0.0.4–0.0.6 installations can receive 0.0.8 through automatic updates.
Install 0.0.8 manually if 0.0.3 crashes during startup: the affected build cannot
run its updater. Also install manually from 0.0.1/0.0.2. Those older versions
shipped without an updater public key and cannot acquire automatic updates
retroactively. Those published builds install and restart automatically when safe.
The current source changes that policy: verified updates download automatically,
but installation and restart wait for **Restart to Update**. This does not change
the behavior of already-installed older binaries until they receive the fix.

### Apple Silicon macOS

Download the DMG and checksum file from the
[0.0.8 release](https://github.com/yan-ad/iceon/releases/tag/0.0.8) after publication.
For a DMG-only download, compare `shasum -a 256 Iceon_0.0.8_aarch64.dmg` with its
entry in `SHASUMS256.txt`. If all six listed assets are present, use
`shasum -a 256 -c SHASUMS256.txt`. A matching checksum is not publisher identity.
Open the DMG and drag `Iceon.app` into `/Applications`.

The app is **ad-hoc signed, not Developer ID signed or notarized**. If macOS
blocks it, only when you trust the repository and downloaded release:

```sh
xattr -dr com.apple.quarantine /Applications/Iceon.app
open /Applications/Iceon.app
```

Do not disable Gatekeeper globally or remove quarantine from untrusted downloads.
Native Gatekeeper acceptance, installation, window controls and actual bundle
replacement are not proven by CI metadata checks.

### Windows 32-bit x86

Download
[`Iceon_0.0.8_x86-setup.exe`](https://github.com/yan-ad/iceon/releases/download/0.0.8/Iceon_0.0.8_x86-setup.exe)
and compare its SHA-256 with the checksum file, for example using PowerShell
`Get-FileHash .\Iceon_0.0.8_x86-setup.exe -Algorithm SHA256`. Run the setup to
install for the current user. This is an installer, not a portable raw executable.
If WebView2 is missing, the installer downloads its bootstrapper and requires
network access. Automatic updates use quiet NSIS installation.

Neither application nor installer has an Authenticode certificate. SmartScreen
may warn about an unknown publisher; this guide does not bypass SmartScreen or
recommend disabling Windows protection. Windows compilation, installer execution,
WebView2 setup and update/relaunch smoke checks remain pending. No Linux, Intel
macOS, Universal macOS or separate Windows ARM/x64 installer is built by this route.

## Other routes

- [Historical signed stable tooling](releasing.md): `v*` tags, Developer ID and
  notarization requirements, macOS-only packaging. Not the 0.0.8 publication route.
- [Dry run](release-dry-run.md): the separate packaging rehearsal, not publication
  or evidence of current two-platform update coverage.
- `.github/workflows/prerelease-unsigned.yml`: separate prerelease tags and policy,
  not this stable/latest feed. Historical release tags/assets remain unchanged.
