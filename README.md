<img width="64" height="64" alt="Iceon" src="src-tauri/icons/128x128.png" />

# Iceon

A desktop workspace for everyday Kubernetes work.

Iceon brings cluster contexts, resource navigation, and troubleshooting into one
place. Browse workloads in compact tables, inspect an object beside its list,
and open Pod logs or a shell without leaving the workspace.

The goal is a familiar daily workspace where you can understand what is running,
investigate a problem, and take the next action without constantly switching tools.

[Download Iceon 0.0.1](https://github.com/yan-ad/iceon/releases/tag/0.0.1)

## What you can do today

- Keep cluster contexts and saved web links in a searchable Catalog, with pins
  for the entries you use most. Importing a kubeconfig does not connect a cluster.
- Navigate Kubernetes resources by category and namespace, filter dense tables,
  and inspect supported resource details in a resizable side panel.
- Read Pod logs, start exec or attach sessions, and manage local port forwards.
  Available actions depend on the cluster's permissions and the selected resource.
- Create resources from YAML and review supported resource deletions before
  submitting them. Resource creation includes a server dry-run and confirmation.
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

## Install on macOS

The 0.0.1 download is for **Apple Silicon Macs only**. Intel Macs, Windows, and
Linux installers are not included in this release.

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
Automatic application updates are disabled. Download future versions manually
from [GitHub Releases](https://github.com/yan-ad/iceon/releases).

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
The project uses [Tauri](https://tauri.app/) and [Astryx](https://astryx.atmeta.com/),
with [Freelens](https://github.com/freelensapp/freelens) as a workflow reference.
