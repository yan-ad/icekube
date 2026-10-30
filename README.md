<img width="64" height="64" alt="Iceon" src="src-tauri/icons/128x128.png" />

# Iceon

> [!IMPORTANT]  
> Iceon is in early development. Even patch releases may disrupt existing workflows;
> use it with caution.

A desktop workspace for everyday Kubernetes work.

Iceon brings cluster contexts, resource navigation, and troubleshooting into one
place. Browse workloads in compact tables, inspect an object beside its list,
and open Pod logs or a shell without leaving the workspace.

The goal is a familiar daily workspace where you can understand what is running,
investigate a problem, and take the next action without constantly switching tools.

[Iceon 0.0.6 downloads](https://github.com/yan-ad/iceon/releases/tag/0.0.6)
for Apple Silicon macOS and Windows 32-bit x86.
[Latest published release](https://github.com/yan-ad/iceon/releases/latest).

## What you can do today

- Keep cluster contexts in a searchable Catalog, with pins
  for the entries you use most. Importing a kubeconfig does not connect a cluster.
- Navigate Kubernetes resources by category and namespace, filter dense tables,
  and inspect supported resource details in a resizable side panel.
- Read Pod logs, start exec or attach sessions, and manage local port forwards.
  Available actions depend on the cluster's permissions and the selected resource.
- Create resources from YAML and review supported resource deletions before
  submitting them. Resource creation includes a server dry-run and confirmation.
- Review permission-aware navigation and scoped actions. Access Control > Users
  manages namespace-scoped ServiceAccounts and template-based grants with
  exact-rule review, server dry-run, and confirmed create, edit, or delete.
  This is not human identity-provider account CRUD and does not export tokens
  or credentials. For scope and verification limits,
  see [permission management](docs/permission-management.md).
- Browse Helm charts and releases, and install charts.
  Helm workflows require an optional local Helm binary.
- Browse custom-resource definitions and read metadata-only custom-resource
  lists. Custom-object details and editing are not available yet.
- Check workload summaries, warning events, and current CPU and memory snapshots
  where Metrics Server is available. Missing metrics remain unavailable.
- Choose Light, Dark, or System appearance and collapse navigation when you need
  more room for a table or inspector.

Iceon is early in development. Detail coverage varies by resource kind. Loading,
empty, failed, stale, and partial results have distinct states, so a retained list
is not presented as a fresh or complete view of the cluster.

## Local performance comparison

Measured **2026-10-29**, using the installed **Iceon 0.0.6** and **Freelens 1.10.3**
ARM64 apps—no rebuilds—on an Apple M4 Mac with 16 GiB RAM and macOS 27.0.1.
The user confirmed matching connected Pods views: same cluster, namespace and Pod
count, with optional inspectors, logs, terminals and forwards closed. Both apps
ran concurrently, untouched, for three consecutive 60-second sampling windows.

| Metric | Iceon 0.0.6 | Freelens 1.10.3 |
| --- | ---: | ---: |
| Median physical memory footprint, including attributed helpers | 148.5 MiB | 398.1 MiB |
| Observed memory footprint range | 148.2–149.6 MiB | 322.1–402.3 MiB |
| Mean CPU, 100% = one logical core | 0.53% | 0.47% |
| 95th-percentile one-second CPU | 1.15% | 0.30% |
| Installed app bundle, regular-file bytes | 13.7 MiB | 574.9 MiB |

Iceon's median memory footprint was **62.7% lower in this session**. CPU was low
for both and slightly higher for Iceon on average; this is not a CPU-efficiency
win. Bundle size is storage, not speed, and excludes Iceon's OS-provided WebKit
runtime while Freelens includes Electron.

**This does not establish an overall performance winner.** Startup, refresh/API
latency, search/scroll responsiveness, sustained load and battery use were not
measured. This is one local session with different app uptimes and uncontrolled
background work, not independent benchmark trials. Accessibility access was
denied, so matching views were user-confirmed rather than inspected automatically;
the exact Pod count was not retained. See the
[methodology, per-window results and raw data](docs/benchmarks/2026-10-29-macos.md)
and [read-only macOS sampler](tools/benchmarks/macos_apps.py) to reproduce or extend it.

A [follow-up source optimization](docs/benchmarks/updater-render-optimization.md)
removes redundant updater-context renders. It is not part of the installed-build
measurements above, and native CPU savings have not been measured.

## Install

For **Apple Silicon Macs**, download `Iceon_0.0.6_aarch64.dmg` from the
release page and drag `Iceon.app` to `/Applications`. Intel Macs and Linux
installers are not included. Publication requires full CI and packaging checks.

The app uses ad-hoc signing. It is not Developer ID signed or Apple notarized,
so macOS may block it on first launch.

Download the DMG and checksum file from the release page. Verify the download
against the published SHA-256 checksum, then drag `Iceon.app` to `/Applications`.
**Only if you trust the repository and downloaded release**, remove quarantine
from this installed app before opening it:

```sh
xattr -dr com.apple.quarantine /Applications/Iceon.app
```

A matching checksum detects corruption; it does not authenticate the publisher.
Never disable Gatekeeper globally or remove quarantine from an untrusted download.

For **Windows 32-bit x86**, use
[`Iceon_0.0.6_x86-setup.exe`](https://github.com/yan-ad/iceon/releases/download/0.0.6/Iceon_0.0.6_x86-setup.exe).
The installer targets the current user and downloads WebView2 if missing, so that
step needs network access. It has no Authenticode certificate; SmartScreen may
show an unknown publisher. CI verifies Windows x86 compilation and packaging;
native installation and update smoke checks remain outstanding.

If 0.0.3 crashes immediately on launch, manually install this patch: that crash
occurs before its updater can download a fix.

Working 0.0.4 installations can update automatically to 0.0.6. Older 0.0.1/0.0.2
installations need a manual install because they have no updater trust key. After bootstrap, Iceon
checks GitHub for signed newer versions and automatically installs and restarts
when all windows and backend work are safe. It does not save or discard drafts
for you. See [automatic updates](docs/automatic-updates.md) and
[installation details](docs/releases.md) for the trust model and OS warnings.

## Where Iceon is heading

Future work aims to broaden familiar resource-table and detail workflows.
Prometheus-backed historical metrics are also a future goal, not a current feature.
Today's metrics are snapshots, not historical monitoring.

## Project

Iceon is open source under the [GNU GPL v3 license](LICENSE).
Created by [Yanuar](https://github.com/yan-ad). See the [changelog](CHANGELOG.md)
for release notes.

For development, see the [project guide](AGENTS.md), [design direction](DESIGN.md),
and [workspace behavior reference](docs/workspace-ui-reference.md).

### Debugging the React UI in a browser

Run `bun run tauri:inspect`, then open `http://127.0.0.1:1420` in your browser.
The same command starts the desktop app, React DevTools integration, and a
development-only Rust engine for the browser. Use `bun run dev:web` if you do
not need a desktop window. Plain `bun run dev` remains a UI-only preview.

The browser engine automatically discovers `~/.kube/config` on Catalog load and
Refresh, using the same Rust discovery and validation as the desktop app. Discovery
imports context metadata only; entering a cluster workspace can authenticate and
connect, and confirmed operations affect the selected cluster. `KUBECONFIG` and
directory scanning are not used.

Browser development records/preferences are stored separately in `.iceon-dev/`,
not the desktop app's data directory. The two engines do not share live sessions.
Native file dialogs, window controls, menus, updater, and OS link opening remain
desktop-only. Browser cluster sessions are single-tab owned and cleaned up on
disconnect, tab disposal, or heartbeat expiry.

The bridge is debug-only, loopback-only, and authenticated through Vite; its secret
is never sent to the renderer. It is not a deployment backend. Stop the development
command to stop its engine. Restart an already-running inspect command after
updating these scripts.

Vite and Tauri use the same literal IPv4 loopback address so an old preview and a
new inspect server cannot silently split port 1420 across IPv4 and IPv6. If startup
reports that the port is occupied, stop the previous development command first.

For fixtures, set `ICEON_DEV_DISCOVERY_HOME=/absolute/fixture/home` to discover that
home's `.kube/config`, or `ICEON_DEV_DATA_DIR=/absolute/dev/data` to change storage.
`ICEON_DEV_PORT` selects a different loopback port for `dev:web`; Tauri's inspect
URL stays on 1420. `bun run test:dev-engine` uses temporary homes, synthetic
kubeconfigs, and port 1430; it never reads your real configuration or authenticates.

The project uses [Tauri](https://tauri.app/) and [Astryx](https://astryx.atmeta.com/),
with [Freelens](https://github.com/freelensapp/freelens) as a workflow reference.

CI runs browser fixtures in eight Linux shards with two workers per runner.
Each keeps a 480-second suite limit, a 10-minute test-step limit and a 20-minute
job limit, with setup in separate steps. These are per-browser-job bounds, not
an end-to-end release-time guarantee; packaging jobs have 90-minute limits.

## Credits

Inspired by Permission Manager by SIGHUP (BSD-3-Clause).
[Permission Manager](https://github.com/sighupio/permission-manager), reviewed at
[`fb6f65e161ac792ab290ffe680d6420caf834a43`](https://github.com/sighupio/permission-manager/tree/fb6f65e161ac792ab290ffe680d6420caf834a43),
is a workflow reference, not a bundled service. Its root
[license](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/LICENSE.md)
states `Copyright (c) 2020, SIGHUP`. No upstream source, assets, or manifests were
ported for this workflow; Iceon's implementation is original code under its
existing GPL v3 license. This credit does not relicense Iceon or imply endorsement.
