# TauLens mainline-to-Tauri migration

## Scope

Port the existing Electron mainline behavior to Tauri first. Preserve the current
UI, layouts, styling, navigation, workflows, user data, and extension contracts.
Change only the runtime integration needed to make those features work in Tauri.

Apple Silicon macOS is the primary MVP target. Other platforms follow afterward.

Do not redesign screens, adopt Astryx UI, migrate the backend to Bun, add features,
or refactor unrelated code during this phase. Those are separate workstreams.

## Progress

- **Mainline** count the behavior at the Freelens electron desktop
- **Ported** counts the behavior that ported and working in tauri version
- **%** is `Ported / Mainline × 100`. Calculate total progress from summed counts.
- **0%** means no complete checkpoints have recorded parity verification. It does
  not mean that no Tauri implementation exists.

| Feature | Mainline | Ported | % |
| --- | ---: | ---: | ---: |
| Application lifecycle and windows | 9 | 0 | 0% |
| IPC, identity, and synchronization | 8 | 0 | 0% |
| Networking, origins, TLS, and downloads | 10 | 0 | 0% |
| Persistence, files, and user data | 10 | 0 | 0% |
| Cluster discovery and connection | 1 | 0 | 0% |
| Cluster authentication | 1 | 0 | 0% |
| Kubernetes proxy lifecycle | 1 | 0 | 0% |
| Kube resource lists, details, and watches | 1 | 0 | 0% |
| Resource create, edit, apply, and delete | 1 | 0 | 0% |
| Metrics and charts | 1 | 0 | 0% |
| Helm workflows | 1 | 0 | 0% |
| Logs and exported files | 1 | 0 | 0% |
| Exec, attach, and port forwarding | 1 | 0 | 0% |
| Catalog, hotbar, and workspace navigation | 1 | 0 | 0% |
| Terminals and subprocesses | 6 | 0 | 0% |
| Bundled tools and native dependencies | 4 | 0 | 0% |
| Extension contracts and lifecycle | 19 | 0 | 0% |
| Renderer, editor, clipboard, and accessibility | 6 | 0 | 0% |
| Application menus | 1 | 0 | 0% |
| Tray and dock | 1 | 0 | 0% |
| Native dialogs | 1 | 0 | 0% |
| Deep links | 1 | 0 | 0% |
| Login, native theme, and system integration | 1 | 0 | 0% |
| Existing notifications | 1 | 0 | 0% |
| Diagnostics | 1 | 0 | 0% |
| Source builds, DI, and developer tooling | 4 | 0 | 0% |
| Packaging, signing, and distribution | 7 | 0 | 0% |
| Test automation and behavior comparison | 4 | 0 | 0% |
| **Total** | **104** | **0** | **0%** |

### Catalog comparison boundary

Catalog and Pods are page-level comparison targets. A page is complete only after its
mainline behavior is ported, compared, and accepted; partial implementation does
not increment the completed checkpoint counts above.

The development runtime uses the shared launcher, Catalog category/list/header,
input, avatar and hotbar presentation. Its Node backend discovers context metadata
from immediate files under `~/.kube`, using the existing kubeconfig schema and
validation/salvage rules. It does not open the Electron profile, resolve referenced
credential files, execute authentication plugins, contact clusters, or write
kubeconfig files. Only context names, stable identities, source labels and local
status cross the bounded snapshot protocol. Local clusters start disconnected.
Catalog refreshes metadata while it is open; unreadable or bounded-out files
produce non-secret warnings.

Search, category filtering, sorting, labels, column visibility, row menus and
pin/unpin operate within Catalog. The hotbar uses the existing model and default
layout. Pins survive navigation and webview reloads inside the temporary Tauri
development profile, not a normal quit/relaunch. Built-in Preferences is visible,
but its page is not ported. Cluster Connect/Settings, full live entity details,
search linking, hotbar switching/reordering and durable profile integration remain
unverified or unavailable. These gaps prevent a full Catalog UX parity claim.

Unimplemented controls carry a visible `SOON` marker. The marker identifies a gap;
it does not count as a ported checkpoint. Selecting a local cluster opens the
cluster sidebar and Pods page without automatically authenticating. Catalog
metadata inspection remains available through View Details.

### Cluster sidebar and Pods comparison boundary

The cluster route now renders the full static built-in sidebar inventory and the
original Workloads tab order. Every unported leaf and tab is disabled and visibly
marked `SOON`; group expansion remains functional. Pods is the only enabled
resource page in this checkpoint.

Pods loading requires an explicit user action because it may resolve the selected
kubeconfig authentication and contact the cluster. The Tauri Node sidecar runs that
read in an owned worker process with a deadline covering discovery, authentication
and listing, bounded API responses, pagination and process-tree cleanup. It uses
the selected kubeconfig context only. A backend-private fingerprint pins the
selected context/cluster/user configuration for repeated reads. Changed selected
configuration requires restarting the application; the public Catalog ID is not
an authorization grant. Referenced credential file contents are not fingerprinted.
It returns sanitized Pod summaries: name, namespace, owner, status, container readiness,
restart count, age and unavailable-metric markers. Pod specs, images, environment
values, annotations, credentials, auth-plugin stderr and Kubernetes error bodies do
not cross the bridge.

The page supports all-namespaces and namespace-scoped reads, search, sorting,
column visibility, refresh, retry, empty/loading/error states and safe warnings.
It intentionally does not mutate resources or enable logs, shell, details, create,
delete, or other resource pages. Those controls are visibly `SOON`. CPU and memory
metrics show `N/A`, not fabricated values. Namespace choices come from returned
Pods; a namespace can be entered explicitly when cluster-wide listing is denied
or a full namespace inventory is unavailable. Stop refreshing revokes page-level
consent and discards pending results; the owned worker still has its bounded
deadline. Polling resumes only after another Load Pods action.
The selected cluster remains disconnected in Catalog until the separate cluster
activation/proxy checkpoint is ported. This is a verified read-only Pods slice,
not full Kubernetes parity.

Run the current page with `node scripts/run-tauri.mjs`. `pnpm test:tauri`,
`pnpm smoke:tauri` and `pnpm check:tauri` use synthetic temporary kubeconfigs,
never the real home directory. Tests assert that discovery does not execute
authentication plugins and credentials/endpoints are not serialized. Pods tests
use loopback API fixtures and synthetic credentials. Native macOS smoke traverses
Welcome, Catalog and the Pods page without clicking Load Pods.

For comparison, open the same mainline page with the same theme and window content
size. Check launcher/titlebar alignment, hotbar icons/cells, categories, item count,
row icons and labels, search/clear, sorting, column visibility, menus and pinning.
Record differences before selecting another page. An installed release can differ
from the current mainline revision; font rasterization in the system webview can
also differ from Electron.

## Agent workflow

1. Pick a feature row. Identify its existing mainline behavior and the specific
   checkpoints being ported before changing code. Record that checklist in the
   task or pull request so the completion count can be reviewed.
2. Replace Electron integration with Tauri equivalents while preserving the UI
   and observable behavior. Do not count a mock, placeholder, disabled action or
   `SOON` marker as equivalent to a working mainline feature. Deferred actions may
   be visibly marked `SOON` in development so their remaining work is traceable.
3. Verify the same scenarios in mainline and Tauri, including errors and cleanup.
   Record test commands, results, target architecture, and remaining gaps in the
   task or pull request. Development checks alone do not verify release packaging.
4. Update the row's **Ported**, **%**, and the total only for verified checkpoints.
   Do not lower **Mainline** to hide missing functionality. If new checkpoints are
   discovered, update the inventory and totals together.
5. Keep other-platform verification separate. Apple Silicon completion does not
   establish support for Intel macOS, Windows, or Linux.
