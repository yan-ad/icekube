# Changelog

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
