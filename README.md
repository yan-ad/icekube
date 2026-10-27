<img width="64" height="64" alt="branding" src="https://github.com/user-attachments/assets/731a88cd-19d2-470b-9649-e990e11d259c" />


# IceKube

[IceKube](https://icekube.yan.ad) is a fast, light, and easy way to manage your Kubernetes cluster easily. It's a supercharged version of FreelensApp

Say goodbye to clunky kube managed experience and don't loose all of your RAM usage for that.

## Why IceKube?
- ⚡️ *Blazing Fast*. It runs in your built in os driver and using Rust as the backend (no node js backend running)
- 👌 *Redefined Looks*. This app is designed for better user experience like modern app did
- 🧱 *Purely Free*. I will never collect money from you to use this app, except you want to buy me a coffee.

## Install the prerelease (Apple Silicon Macs only)

Version **`0.0.1-pre.2`** uses macOS ad-hoc signing, not Developer ID signing
or Apple notarization. See [release and installation instructions](docs/releases.md)
for the exact download, checksum verification and publication checks. This workflow
does not publish Intel, Universal, Linux or Windows installers.

After verifying the checksum and dragging the trusted `IceKube.app` to
`/Applications`, **always run this app-specific command before opening it**:

```sh
xattr -dr com.apple.quarantine /Applications/IceKube.app
```

Do this only if you trust the repository and downloaded release. Never disable
Gatekeeper globally or remove quarantine from an untrusted download. Checksums
detect corruption; they do not authenticate the publisher. Automatic application
updates are disabled in this prerelease: no updater manifest, archive or signature
is published, and its updater public key and endpoints are empty.

CI checks Rust on macOS and Linux, then runs all browser fixtures across four
Linux shards. The Rust job exports the real detail contract once; browser shards
verify its commit and do not compile Rust. Each shard prints individual test
progress and has an eight-minute suite deadline, with failure traces retained.
The unsigned
prerelease workflow runs CI and exact tag/version checks before building, verifies
the ad-hoc app and DMG, uploads a draft and checks its downloaded checksums before
publishing a prerelease (not latest). This describes the workflow, not a claim that
a release or native install smoke test has completed.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Resource selection and deletion

Kubernetes resource tables have row checkboxes and a select-all checkbox for the
displayed page. The selection count and Clear selection replace the first data
heading after the checkbox. Other heading labels are visually hidden without
changing column sizing or removing accessible labels.
Selection resets when you change filters, pages, namespaces, or workspace sessions;
it never selects unseen continuation pages. Rows without safe UID/version metadata
cannot be selected.

Delete sits at the bottom right, immediately beside Create. Review the selected
names, cluster, and context in its confirmation dialog before submitting. Rust
checks each resource's UID and version again and deletes resources one at a time
with Kubernetes preconditions. Successful requests are deselected; failures remain
visible in the results. An accepted deletion can still be waiting for grace periods
or finalizers. Stop cancels pending work, not deletions already sent to the server;
known results are retained, and accepted targets stay deselected. Refresh before
retrying an uncertain result. Loading, failed, or non-syncing live inventory cannot
start a deletion; becoming stale invalidates an open confirmation.

This applies to the 41 allowlisted Kubernetes resource kinds. Helm uninstall and
local port-forward stop/remove are separate workflows, not generic resource deletes.
Automated coverage uses synthetic objects and mocked IPC; it does not establish
real-cluster success or native window behavior.

Create opens YAML creation on Kubernetes tables, Install opens chart installation
on both Helm pages, and Create port forward opens the namespace/Pod/ports form.
These actions sit at the bottom right; Refresh is immediately after Go forward
in the top toolbar, and Live sync remains in Cluster actions. Resource creation and Helm installation require server dry-run followed
by confirmation. Opening a dialog alone does not submit a mutation.

## Workspace UI reference

- Resource tables, including Nodes/Namespaces, automatically repeat bounded Rust
  LIST reads on the first page, 10 seconds after completion. Helm inventories and
  Workloads overview use 30 seconds. Reads require a visible, focused, online view;
  editing, dialogs, menus and listboxes pause scheduling. Focus/visibility/online
  return can catch up without overlapping reads or bypassing backoff. Transient
  failures back off to at most 60 seconds; terminal errors stop automatic retries.
  Continuation pages stay manual snapshots, with no automatic page jump. Refresh
  remains available; failed updates retain rows with a stale warning. Fetch-time
  timestamps are no longer rendered. Optional Pod Live sync remains an opt-in
  Rust LIST/WATCH path, not full Freelens watch parity. These inventory updates
  are distinct from application updates, which are disabled in the prerelease.
- Catalog Add config and Add web link are bottom-right icon actions. Refresh
  follows Go forward in the top toolbar; cluster routes place Switch cluster next.
  Preferences and Search are named icons that move into overflow on narrow windows.
  The sidebar no longer repeats the cluster name.
- Add config includes Choose file, a Rust-owned native dialog returning only a
  path. Manual path entry remains available; selecting does not import or connect.
  Existing Rust import validation, including its 1 MiB limit, is unchanged.
- Fixed parent pages show descriptive destination card grids. Actual resource
  inventories remain tables; cards do not imply counts or extra cluster requests.
- Cmd/Ctrl+R refreshes the active Catalog or workspace view, including Cluster
  Overview and custom-resource rows. When focus is in the resource inspector,
  its capture handler refreshes details without refreshing the table behind it.
- Search drafts stay controlled while server search waits for 160 ms of quiet
  input. Obsolete reads cancel, retained rows are marked stale and affected actions
  disable. Cached local filtering uses deferred/memoized work, not a request per key.
  This is not an FPS or latency benchmark.
- Initial content loading uses a centered, named Astryx spinner. Retained content
  uses a nonblocking bar below filters, with reduced-motion support; refresh errors
  remain visible. Light, Dark and System apply from saved Preferences, not live
  drafts. Asynchronous initial preferences loading has no no-flash guarantee.
- Blocking first-load errors are centered below search/filter controls, not
  disguised as empty tables. Failed updates with retained data use a compact
  error/stale notice. Retry hints appear only for working retry actions.
- Known positive statuses use Astryx success colors; warning/error states retain
  their meanings. Unknown states and generic booleans stay neutral. The Azure
  accent is generated through Astryx CLI from `#0074e2` and mapped to theme roles;
  neutral surfaces, green success statuses and black log surfaces are preserved.
- Catalog cluster status comes from Rust's current runtime lease rather than a
  hardcoded Disconnected label. Status polling reads in-memory state only, never
  credentials or the cluster. Leaving a workspace still releases its connection;
  the Catalog follows that release rather than retaining a historical green badge.
- Sidebar transitions preserve navigation context; exiting cluster navigation is
  inert and hidden from accessibility, and reduced motion removes transitions.
  Show saved metadata opens a named modal from Cluster actions, not an inline panel.
- The GitHub icon immediately before More calls Rust `project_open_repository`
  without a URL argument and opens only `https://github.com/yan-ad/icekube`.
  Browser preview disables it; opener failures remain actionable and sanitized.
- Resource details use a bordered, resizable right sidebar that reflows the
  workspace, not an overlay. Named Refresh, Expand/Restore and Close icons,
  keyboard resizing and reduced-motion transitions are supported. The compact
  header shows the plain name, Pod Logs/Shell/Attach/Port forward icons where
  applicable, and one Refresh. The body scrolls independently and retains stale
  details after failed refresh. Closing
  unmounts content and cancels its reads while an inert empty shell collapses.
- CodeJar 4.3.0 with highlight.js YAML runs as browser code in Pod YAML,
  resource creation and Helm values. Read-only and busy states prevent edits;
  Rust still owns validation, dry-run and mutations. No runtime Node backend
  is introduced.
- Workloads overview shows seven status donuts from loaded inventories, with
  sequential reads bounded to five pages/500 resources per kind. It labels
  loading, partial, stale, empty and failed results, not live cluster totals.
  Latest events shows ten entries from loaded pages, including bounded message,
  source, count and occurrence times. Projected text is not guaranteed secret-free.
- Cluster Overview separately shows actual Nodes/Metrics Server CPU and memory
  snapshots and Warning Events with scoped details. Reads are bounded to one page
  of 100 nodes and 100 events. Missing/incomplete metrics remain unavailable;
  loaded counts are not cluster totals. No Prometheus integration is configured,
  so historical charts are unavailable rather than populated with sample data.
- CRD inventory starts at limit 10 and retries an oversized page at limit 1 with
  the same token. Only CRD single-object reads get a 16 MiB body allowance;
  projected CRD items remain bounded to 64 KiB. Ordinary response caps are unchanged.
  Custom Resources preserves Definitions and adds lazy group/kind navigation to
  read-only metadata lists. Discovery batches at most 10 requests in 5 seconds,
  caps retained definitions at 1,000 and offers Load more for continuation. Existing
  CRD pages hold only 10 definitions (or 1 on oversized retries), so discovery does
  not guarantee all definitions in one batch. Rust verifies the actual CRD UID,
  establishment, scope and served/storage version before instance reads. No
  custom-object detail/edit/delete controls or arbitrary URL requests are exposed.
  See [custom resources](docs/custom-resources.md).
- Generic detail and cancel commands now extract the registered shared
  `Arc<ConnectionEngine>` Tauri state. RBAC names such as `system:Reader` use
  kind-aware shared validation/projection and percent-encoded path segments.
  The command-state regression inspects source; it is not a native IPC invocation.
- Configured exec/token-file credentials support bounded request-time renewal.
  See [credential renewal](docs/credential-renewal.md) for the 30-second margin,
  one-read retry, cancellation and exclusions. Static/cached legacy credentials,
  Helm authentication and restarting established streams are not covered.

See [workspace UI reference](docs/workspace-ui-reference.md) and
[resource inspector reference](docs/resource-inspector-reference.md) for source,
ownership and acceptance-test mappings. These are behavior references, not
full Freelens parity. Final validation of this revision is pending; previous
suite totals are not current results. The native file picker and actual-cluster
smoke tests have not been performed. Browser fixtures and static bundle checks
do not prove native-window, Gatekeeper-installation or real-cluster behavior.

The manual [release dry run](docs/release-dry-run.md) runs full CI before an ARM64
ad-hoc app/headless DMG build and static verification, including the app inside a
read-only mounted image. It does not bump `0.0.1-pre.2`, create a tag or Release,
use signing secrets, or publish updater artifacts. Its Actions artifacts expire
after seven days and are not confidential on a public repository.

## Standalone React DevTools (development only)

Icekube can opt into the standalone React DevTools bridge for local React 19
webview development. It is disabled by default: ordinary `bun run dev`, Tauri
builds, and production assets do not inject the bridge or include it in the
frontend bundle. CSP and Tauri capabilities are unchanged.

In one terminal, start the official `react-devtools` package (version `8.0.0`,
checked against the npm registry on 2026-10-26):

```sh
bun run devtools
```

In another terminal, opt into the Vite bridge:

```sh
bun run dev:inspect
```

For the Tauri development webview, use `bun run tauri:inspect` instead. The
opt-in injects `http://127.0.0.1:8097` at the beginning of `<head>` before the
React module is evaluated. These Bun scripts set `ICEKUBE_REACT_DEVTOOLS=1`;
only that exact value enables injection, and only while Vite serves development
HTML. Start DevTools first, then reload the browser/webview after connecting or
restarting it. If DevTools is not running, the script request fails and inspection
is unavailable; ordinary development can continue without the opt-in.

`bun run devtools` fixes the listener to loopback `127.0.0.1:8097`. Stop the
DevTools window/process when finished, and restart normal development without
the opt-in to remove the bridge. Neither `dev:inspect` nor `tauri:inspect`
automatically starts a listener. `bun run dev` makes no DevTools requests unless
you explicitly supply the opt-in environment variable.

Standalone DevTools uses its own Node/Electron development-tool process. It is
not Icekube's runtime, backend, or a packaged sidecar. Node must be installed to
run the upstream launcher; Bun manages the local dev dependency. Do not inspect
real credentials or cluster sessions: DevTools can inspect component props/state.
This setup does not grant permissions or relax CSP; platform webview/security
restrictions may prevent a connection. Native webview inspection must be checked
on each target OS rather than inferred from browser HTML tests.

This follows the official React standalone guidance:
[`react.dev/learn/react-developer-tools`](https://react.dev/learn/react-developer-tools)
and the [`react-devtools` npm package](https://www.npmjs.com/package/react-devtools).

## References
- [Freelens.app](https://github.com/freelensapp/freelens) The app reference to how this project was made of
- [Tauri](https://github.com/tauri-apps/tauri) This how's we made the app possible
- [Astryx](https://astryx.atmeta.com/) Ui component this project was made of
