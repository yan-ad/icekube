# Changelog

## 0.0.2

### Included changes

- Permission-aware resource navigation and scoped action menus distinguish
  allowed, denied, checking, stale, and unknown access. Read-only means a known
  allowed read with known denied relevant writes; unknown access is labeled
  Access unverified, not Read-only. Kubernetes remains the authorization boundary.
- Access Control > Users is an actual managed ServiceAccount workflow, not only
  an observed-subject directory: select a namespace, create or edit assignments
  from existing template ClusterRoles, review exact rules and a server dry-run
  plan, then confirm apply or deletion. New accounts disable token automount.
  Plans expire after 120 seconds, are consumed once, and bind session,
  authorization epoch and UID/resourceVersion baselines. Partial execution stops
  without automatic rollback. No namespace/role seeding, User CRD, token Secret,
  credential export or human identity-provider account CRUD is included.
- Credit SIGHUP's BSD-3-Clause Permission Manager as a pinned workflow reference;
  no upstream source was ported and Iceon's GPL v3 license is unchanged.

### Fixes since 0.0.1

- macOS credential-helper path resolution, including the GKE helper, accounts
  for GUI launch environments using bounded known installation locations without
  a login shell or directory scan. This work landed in
  `69ec0c2938fa3be1a1af9b98e28117ba1dd4c080`; it does not install a helper or
  guarantee that any cloud login is available.

### Verification and distribution

Local validation passed 328 backend Rust tests, 9 release-tool tests, and the
managed-user, permission, lifecycle and mutation fixture regressions. Build,
formatting and strict Clippy checks passed. Full cross-platform CI and package
verification gate publication. Native installation, real-cluster RBAC and
credential-helper smoke testing were not performed. The published 0.0.1
installer and its warnings remain unchanged.
See [permission management](docs/permission-management.md) for scope and
acceptance criteria, including limits on permission coverage.

### Download and installation warning

The installer is `Iceon_0.0.2_aarch64.dmg`, containing `Iceon.app` for Apple
Silicon Macs only. Publication requires full CI and packaging checks.
The app is **ad-hoc signed, not Developer ID signed or notarized**; macOS may
block it. No Intel, Universal, Linux or Windows installer is included. Automatic
updates are disabled; no updater archive, updater signature or `latest.json`
is published by the unsigned route.

Download the DMG and `SHASUMS256.txt` from this exact release.
Verify the download in its directory:

```sh
shasum -a 256 -c SHASUMS256.txt
```

Checksums detect corruption, not publisher identity. Open the DMG and drag
`Iceon.app` into `/Applications`. **Only if you trust this repository and this
downloaded release**, remove quarantine from the installed app and open it:

```sh
xattr -dr com.apple.quarantine /Applications/Iceon.app
open /Applications/Iceon.app
```

Do not disable Gatekeeper globally or remove quarantine from untrusted downloads.
Connect only to clusters and credentials you intend the application to use.
The published `0.0.1` tag and installer are not overwritten by this release.

## 0.0.1

Iceon is a Kubernetes desktop workspace. This release uses the Iceon name for
the application, repository links, executable, bundle identifier, and native menus.
It uses `ad.yan.iceon`; data from older application identifiers is not migrated
automatically.

### Included in this release

- Catalog navigation, search, metadata-only kubeconfig import, default-file
  discovery, saved web links, record colors and individual item pins.
- Rust-owned connection and resource workflows with scoped session identities,
  bounded resource inventory and safe detail projections, plus supported Pod,
  Helm and custom-resource workflows. Importing kubeconfig metadata does not
  authenticate or connect to a cluster. Opening a workspace starts its configured
  connection flow.
- Resource inspector loading, empty, partial, stale and error states. Secret and
  ConfigMap bodies and arbitrary custom-object payloads are not exposed as a
  generic raw-data detail view.
- An Apple Silicon macOS application and a headless DMG packaging route gated by
  the full reusable Rust and browser-fixture CI suite.

### Download and installation warning

The only installer is `Iceon_0.0.1_aarch64.dmg`, for Apple Silicon Macs. It is
**ad-hoc signed, not Developer ID signed or notarized**. macOS Gatekeeper may
block it. There is no Intel, Universal, Linux or Windows installer in this
release. Automatic updates are disabled. No updater archive, updater signature
or `latest.json` is published.

1. Download the DMG and `SHASUMS256.txt` from this exact release. In the download
   directory, verify them with:

   ```sh
   shasum -a 256 -c SHASUMS256.txt
   ```

   Checksums detect corruption, not publisher identity.
2. Open the DMG and drag `Iceon.app` into `/Applications`.
3. **Only if you trust this repository and this downloaded release**, remove
   quarantine from this installed application and open it:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Iceon.app
   open /Applications/Iceon.app
   ```

Do not disable Gatekeeper globally or remove quarantine from untrusted downloads.
Connect only to clusters and credentials you intend the application to use.

### Limits and verification

This is an early stable version number, not a claim of full Freelens parity or
extension compatibility. Resource details remain bounded safe projections,
not complete upstream resource editors. Generic detail metrics, live related
resource lists, full Helm release editing and arbitrary custom-object editing
are not established as equivalent workflows.

CI uses fixtures and mocked IPC, not production credentials or real clusters.
Packaging checks inspect signatures, ARM64 architecture, application metadata,
DMG contents and uploaded bytes. They do not prove native window/file-picker
behavior, Gatekeeper acceptance, actual installation, or live cluster behavior.
A real Apple Silicon native installation and interactive smoke test remains
outstanding; no such native verification is claimed by these notes.
