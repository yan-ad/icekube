# Automatic application updates

Starting with 0.0.3, supported packaged release builds check the public
[GitHub latest feed](https://github.com/yan-ad/iceon/releases/latest/download/latest.json).
Rust owns transport, trust checks, staging, installation and restart in
`src-tauri/src/updates.rs`. React presents state and reports window readiness;
it does not fetch packages, handle signing secrets or install files.

## Bootstrap and trust

0.0.1 and 0.0.2 shipped with no updater trust key and automatic updates disabled.
Install 0.0.3 manually once using the [platform installer](releases.md). This
cannot be enabled retroactively in those installed binaries. After bootstrap,
subsequent verified stable updates install automatically when safe; there is no
separate manual installation step after staging.

The app embeds the public minisign key in `plugins.updater.pubkey`, requires
signed versions and uses Tauri's official restore/verify/install APIs. The
matching private key stays in the GitHub Actions signing secret, never the
renderer, repository or release assets. Missing trust configuration disables
updates. There is no unsigned fallback and no automatic key replacement.
Losing the signing key requires an explicit trust-migration/bootstrap plan.

The feed itself is not a separately signed document. Rust selects a newer stable
SemVer without prerelease/build metadata, requires the selected raw URL to match
Tauri's restored URL, and permits only the exact version/target asset under
`https://github.com/yan-ad/iceon/releases/download/<version>/` (or the matching
`v<version>` tag). Tauri verifies the package signature and authenticated version;
a changed manifest version cannot authorize differently versioned signed bytes.
SHA-256 checksums and GitHub asset digests are release transfer checks, not the
application's update authority.

## Supported packages and network bounds

| Runtime | Feed key | Update package |
| --- | --- | --- |
| macOS aarch64 | `darwin-aarch64` | `Iceon_<version>_aarch64.app.tar.gz` |
| Windows x86 | `windows-i686` | `Iceon_<version>_x86-setup.exe` |

Debug builds and unsupported targets do not run the updater. Browser preview
cannot update the application. A packaged build checks at startup and every
five minutes; Check for updates can request a check without supplying a URL.
A staged or preparing update is not overwritten by another check.

The HTTPS-only Rust client allows at most five redirects, limited to GitHub and
its release asset hosts. Manifest reads are limited to 256 KiB and 30 seconds;
package reads to 256 MiB and 180 seconds. Size limits apply to streamed bytes,
not just Content-Length. The client disables implicit environment proxies and
accepts only the explicit validated proxy configuration (HTTP/HTTPS origin,
without credentials, query or fragment). Cancellation stops updater work and
app shutdown discards staged data. No cluster credentials are used for downloads.

## Safe preparation and restart

The normal lifecycle is `idle`, `checking`, `downloading`, `ready`, `preparing`,
then `restarting`. Failures report `error`; unsupported/unconfigured contexts are
`disabled`, and shutdown is `stopped`. These states describe updater progress,
not a claim that a release has already installed or been natively tested.

1. Verified bytes are staged in Rust. The engine attempts installation
   automatically, but every admitted native window must first report fresh safe
   readiness. Readiness leases last five seconds. Unknown or unready windows
   defer installation, including hidden windows with retained drafts.
2. Rust creates a fresh preparation ID. `WindowGate` freezes admission, blocking
   new windows. Each renderer checks draft/blocker state before making the root
   inert and intercepting interaction (including portals), then acknowledges
   **that preparation ID** after freezing. A stale acknowledgement cannot
   authorize a later attempt.
3. Dirty inputs, contenteditable surfaces, open dialogs/menus and registered
   editor/operation blockers pause preparation. This is a quiesce protocol, not
   autosave: it never saves, discards or edits a user's draft. All admitted
   windows must provide fresh prepared acknowledgements. An unsafe report or
   ten-second preparation timeout thaws interaction and returns to Ready.
4. The backend reserves worker permits and refuses shutdown while runtime
   sessions (including terminals/forwards) or managed permission mutations are
   active. It closes new backend work admission, invalidates session/auth
   generations, cancels subscriptions, drops the connection and drains owned
   helper/session tasks before invoking the installer.
5. The official Tauri updater replaces the macOS `.app` bundle or runs the
   Windows NSIS installer. It does not blindly overwrite a raw executable.
   Windows uses quiet, current-user installation. After success Rust requests
   application restart. Installation failure reports an error, thaws windows
   and reopens backend admission; it does not claim work was restored.

The optional restart command starts the same preparation gate and cannot bypass
it. Native New Window and other admission points remain blocked during
preparation/restart. The UI exposes Preparing and Restarting as progress, not as
an invitation to continue editing. A user should finish or close active work to
allow a staged update to proceed.

## OS trust and verification limits

Updater artifact signatures are independent of Developer ID, Authenticode and
notarization. This route needs no paid OS signing certificate. macOS remains
ad-hoc signed without Developer ID/notarization; use the app-scoped quarantine
command in [installation](releases.md) only for a trusted first install.
Windows may show SmartScreen/unknown-publisher warnings because it is not
Authenticode signed. No protection bypass is provided. The NSIS installer
requires network access to download WebView2 if it is missing.

`src-tauri/src/updates_tests.rs`, `tests/updates.spec.ts` and
`tests/auto-update.spec.ts` provide fixture-level acceptance coverage for trust,
failures, readiness and preparation. They do not establish real OS replacement,
Windows-native behavior, Gatekeeper/SmartScreen acceptance or real cloud login.
Full release CI, Windows x86 compilation and native install/update/relaunch smoke
checks are pending. The [release workflow](releases.md) audits exactly seven
public assets before marking a release latest.

Reusable CI distributes browser fixtures across eight Linux shards with two
workers each. The per-shard 480-second suite, 10-minute test-step and 20-minute
job limits are unchanged, with setup in separate steps. Sharding does not prove
native update behavior or set an end-to-end release duration; packaging jobs
have separate 90-minute limits.
