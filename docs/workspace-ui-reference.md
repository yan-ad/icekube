# Workspace UI reference

## Source and scope

Behavior reference: local `/Users/user1/Kerjaa/freelens`, Git HEAD
`cd07118f843c4a69f937a319a37a7c12ef2c92d8`, described as
`v1.10.3-533-gcd07118f`. HEAD and the paths below were checked through Git;
referenced components were read. Paths in the source column are relative to
`packages/core/src/renderer/components/`. Iceon keeps Astryx and Rust/Tauri;
this is not full Freelens parity, extension compatibility, or adoption of its
Electron/Node runtime. No upstream implementation was copied in this documentation pass.

| Workflow / upstream source | Expected Iceon interaction and owner | UI states / acceptance mapping |
| --- | --- | --- |
| Catalog: `catalog/catalog-add-button.tsx` | Add config and Add web link are separate named icon buttons at bottom right in `CatalogPage.tsx`/`CatalogForms.tsx`, outside table scrolling. Refresh follows Go forward in `AppToolbar.tsx`. Rust `catalog.rs` owns import, persistence and saved links. | Unavailable/loading disables actions; forms retain safe validation errors; Escape returns focus. `tests/catalog.spec.ts` covers bottom actions and toolbar Refresh placement; parameterized `${category}: bottom actions clear the table and viewport at desktop and narrow widths`. |
| Table selection: `item-object-list/header.tsx`, `item-object-list/list-layout.tsx` (table composition reference; exact heading substitution is Iceon-specific) | `ResourceSelection.tsx` puts selected count and Clear selection in the first data heading after the checkbox. Other heading labels are visually hidden with opacity, not removed; accessible labels and column widths remain. Focused heading controls become visible. Rust deletion services retain UID/version precondition ownership. | None/selected/mixed header, scope reset, disabled unsafe identities. `tests/table-composition.spec.ts`: `${view.label}: selection replaces only heading labels without moving columns`, `filter scope clears selection and restores header labels`. |
| Semantic color: `workloads-overview/overview-workload-status.tsx` (status-chart reference; Astryx badge mapping is local) | `StatusBadge.tsx` maps recognized positive labels to success, failed labels to error, pending/degraded labels to warning. Unknown strings and generic booleans stay neutral. Node Ready=True is success, Ready=False error, positive pressure conditions warning. Rust supplies observed facts; renderer colors do not establish connection/health. | Explicit positive/negative/unknown values in both themes. `tests/semantic-status.spec.ts`: `semantic statuses use Astryx variants without interpreting generic booleans in ${colorScheme}`; `tests/table-composition.spec.ts`: `Pod health uses semantic success and warning colors`. |
| YAML: `dock/edit-resource/view.tsx` (upstream EditorPanel, not CodeJar) | Iceon `YamlEditor.tsx` uses locked CodeJar 4.3.0 and highlight.js YAML browser modules. Actual callers: `PodDetailsView.tsx` (YAML), `ResourceCreate.tsx` (Resource YAML), `HelmInstall.tsx` (Values YAML). Rust `connection/pods.rs`, `connection/create.rs` and Helm services own data, validation and mutations. | Editable/read-only/busy, external value updates, caret/IME, escaped source, disposal. `tests/yaml-editor.spec.ts`: `real CodeJar highlights escaped source and exposes a named multiline editor`, `read-only YAML preserves serialization and rejects keyboard, paste, cut and undo`, `composition is not highlighted or published mid-IME, and commits once`, `unmount removes handlers and pending callbacks cannot publish`. |
| Details sidebar: `kube-object-details/kube-object-details.tsx`, `drawer/drawer.tsx` | `ResourceInspector.tsx` owns a nonmodal, layout-flow sidebar with a separating border, named Refresh/Expand/Restore/Close icons, pointer capture and keyboard resize. Rust `connection/details.rs`/`pods.rs` own scoped reads and cancellation. | Loading, missing/replaced, permission/error, retained stale, open/closed/expanded/dragging; `tests/inspector-resize.spec.ts`: `opening, dragging and expanding reflow the workspace, restore retains the dragged width`, `separator keyboard bounds and reduced motion remain usable on narrow windows`, `close immediately disposes pending content while an empty inert shell collapses`, `pointer cancellation and route disposal end dragging without late detail revival`. |
| Workloads overview: `workloads-overview/overview.tsx`, `overview-statuses.tsx`, `overview-workload-status.tsx` | `WorkloadsOverview.tsx` shows seven status donuts from Rust `connection/transport.rs` LISTs and `resources.rs` projection. Namespace and Refresh restart scoped reads. Category links open their resource tables; event links resolve identity through Rust detail relationships. | Loaded/zero/loading/partial/stale/permission/error remain separate. `tests/workloads-overview.spec.ts`: `uses real loaded counts and never turns unknown Running metadata green`, `bounds pagination and isolates per-kind permission errors`, `refresh retains stale inventory on failure and empty results remain explicit`, `cancels the exact pending read on namespace change and ignores late completion`. |
| Custom resources: `custom-resource-definitions/view.tsx`, `details.tsx`; `custom-resources/view.tsx`, `discovered-custom-resources.injectable.ts` | Definitions remains available. `CustomResourcesProvider.tsx` lazily discovers group/kind destinations; `CustomResourceTable.tsx` displays metadata-only instances. Rust `connection/custom_resources.rs` verifies the named CRD and owns safe paths, metadata negotiation and independent reads/cancellation. No custom-object detail or mutation UI. | See [custom resources](custom-resources.md) for exact bounds and acceptance mapping. Ordinary Definitions retains `connection/crd_fetch_tests.rs` adaptive-fetch regressions. Discovery does not guarantee all definitions in one batch. |
| Cluster overview: `cluster/cluster-overview.tsx` | `ClusterOverview.tsx` uses Rust `cluster_resources` Nodes/metrics and Warning Event reads, each bounded to one page of 100 items. CPU/memory are current snapshots, not Prometheus history. Event relationships resolve scoped details through Rust and the existing inspector. | `tests/workspace-overview.spec.ts`: actual utilization/sorted warning events, unavailable metrics, explicit empty/isolated errors, exact cancellation and late-reply rejection. |

The overview and custom-resource view/discovery paths above were checked through
Git at the recorded commit and their source read for this pass. Destination card
composition, the native picker, centered errors and shortcut priority are local
Iceon refinements, not claims of copied upstream components.

## Requested interaction refinements

| Workflow | Rust / UI ownership and expected interaction | Acceptance source and limits |
| --- | --- | --- |
| Choose file | Rust `catalog_picker.rs::catalog_choose_kubeconfig` opens a main-window native dialog and returns a path or cancellation, never contents. `CatalogForms.tsx` keeps manual entry, ignores disposed dialog replies and imports only after confirmation. Existing `catalog_import_kubeconfig` validates readable regular targets and the 1 MiB bound; the form does not repeat routine size copy. | `tests/kubeconfig-picker.spec.ts`; `catalog_picker.rs` path/cancellation/encoding tests. Browser IPC mocks and synthetic paths, not a native dialog smoke test. |
| Parent destinations | `DestinationGrid.tsx` renders fixed parent destinations as named card anchors with resource-specific descriptions from `destinationDescriptions.ts`. Resource tables are not converted to cards. No destination count/fan-out read is implied. | `tests/destination-grid.spec.ts`: copy, real anchor destinations, accessible descriptions and layout. |
| Content failures | `ContentError.tsx` centers blocking first-load failures below top search/filters; retained rows get compact error/stale feedback. Working retry actions expose a shortcut hint; unavailable browser actions do not. | `tests/centered-errors.spec.ts`: Catalog/Nodes/Pods/Helm failures, retained rows, empty versus failed, narrow themes and busy retry guards. |
| Refresh priority | Cmd/Ctrl+R uses the active Catalog category or registered workspace handler, including overview/resource/custom rows. `ResourceInspector.tsx` captures the chord when focus is within its resource panel, stops propagation and refreshes that object only. Busy/repeated/composing/extra-modifier keys cannot duplicate reads. | Catalog cases in `tests/centered-errors.spec.ts`; focused detail-only cases in `tests/compact-inspector.spec.ts`; overview and custom fixture cases. Native OS/webview shortcut dispatch remains unverified. |

## Cluster Overview snapshot contract

This is separate from the Workloads overview's multi-page donuts below. Nodes and
Warning Events are read sequentially, one page of at most 100 each. Continuation
is partial, not a cluster total. Utilization needs available metrics, a complete
node page and valid per-node usage/denominators. Allocatable is used when valid
for every node, otherwise capacity; missing or invalid inputs remain unavailable.
Independent read failures and stale retained snapshots stay visible. Foreground
updates use the existing 30-second scheduler guards and exact Rust cancellation.

The table shows at most ten Warning Events from the loaded bounded snapshot,
sorted by reported occurrence with creation fallback. Related-object and namespace
buttons resolve through existing validated Event identities in Rust before opening
inspector details. Selected event text remains cluster-provided and
is not guaranteed secret-free. No Prometheus integration is configured; no
historical utilization chart or sample time series is presented as real data.

## Automatic foreground inventory reads

Upstream behavior reference: the previously agent-verified local Freelens commit
`cd07118f843c4a69f937a319a37a7c12ef2c92d8`,
`packages/core/src/common/k8s-api/kube-object.store.ts`, specifically its
`subscribe` workflow. This source is outside the renderer-components path prefix
used in the table above. Subscription is a behavioral reference, not proof that
Iceon polling equals upstream watches. No upstream implementation was copied.

`src/app/cluster/useAutoRefresh.ts` schedules bounded typed IPC reads. Resource
tables (`ResourceTablePage.tsx` and `ClusterResources.tsx`, including Nodes and
Namespaces) refresh their first page 10 seconds after a completed read. Helm
charts/releases and Workloads overview use 30 seconds. Overview retains its
sequential five-page/500-resource-per-kind bounds, including Events; it is not a
single-page total. Rust `connection.rs`, `connection/transport.rs`, `resources.rs`
and Helm services still own reads, projection, validation, bounds and cancellation.

- Only a visible, focused, online document can schedule automatic reads. Focused
  inputs, selects, textareas and contenteditable fields, visible dialogs/alert
  dialogs, menus/listboxes and expanded popups pause them. Pending resource filters,
  active Pod Live sync and Helm installation add their own applicable pause guards.
- Focus, visibility and online return attempt immediate catch-up without bypassing
  busy/pause/backoff guards or overlapping a pending read. Intervals restart after
  completion, not at a fixed request-start cadence. Scope changes reset retry state;
  disposal removes timers/listeners and owning effects cancel their exact reads.
- `timeout`, `network`, `busy` and `connectionFailed` failures back off
  exponentially to at most 60 seconds. Other errors stop automatic retries until
  scope changes or an explicit successful retry. Failed updates keep rows with
  stale/error feedback rather than reconnecting or pretending the inventory is empty.
- Continuation pages remain manual snapshots: there is no automatic page advance
  or jump to page one. Toolbar Refresh stays available. Optional Pod Live sync is
  still opt-in Rust LIST/WATCH, not all-kind watch support or full Freelens parity.
- Resource/Helm automatic reads do not show routine loading chrome for retained
  rows; delivery waits while editing/popups block it. Equivalent snapshots reuse
  inventory when only read IDs/fetch times differ. Fetch timestamps are no longer
  rendered; stale, partial, empty and actionable errors remain visible. This does
  not remove actual resource timestamps such as Age, Last seen or Helm Updated.

Acceptance mapping: `tests/auto-refresh.spec.ts` contains `waits after completion,
never overlaps, and tears down timers`, `backs off transient failures, stops
terminal failures, and resets for a new scope`, `pauses during editing and dialogs,
resumes on focus without a storm`, and `pauses hidden/offline views and refreshes
immediately on return`. `tests/resource-tables.spec.ts` contains `automatic Pod
LIST updates are quiet, do not overlap, and leave continuation pages alone`,
including deferred delivery during a dialog and absence of fetched-time text.
These are source-inspected fixture obligations; their presence alone is not a
passing-suite result or a real-cluster/native-webview check.

## Editor boundary

CodeJar/highlight.js execute as browser JavaScript inside the system webview, not
as a runtime Node service. Highlighting escapes source; it does not validate YAML
or grant permission to submit it. Read-only mode uses `contentEditable=false` and
`aria-readonly`; Tab/Shift+Tab leave the editor. Busy resource creation and Helm
values prevent edits. Existing Rust dry-run/confirmation boundaries are unchanged.
Browser tests exercise real CodeJar and actual YAML snippets, including multiline,
paste, input-only updates and read-only serialization. They are not native smoke tests.
For example, `tests/yaml-editor.spec.ts` initializes the real component with this
literal snippet (an editor fixture, not a complete creation manifest):

```yaml
apiVersion: v1
kind: ConfigMap
```

## Sidebar layout and lifecycle

The inspector takes layout width rather than covering content. It starts at 54%,
is bounded by a measured minimum and 75% maximum, expands to 75%, and restores
its prior width. The named separator supports arrows and Home/End. The resize
handle alone is positioned at the edge; the panel is not an overlay. CSS flex-basis
and opacity transitions are disabled during dragging and under reduced motion.
Close immediately unmounts detail content and cancels its read, while an inert,
accessibility-hidden empty shell collapses. Pointer cancellation and disposal
release capture. This is distinct from Catalog/cluster navigation drawers.

## Loaded overview, not cluster totals

Donuts cover Pods, Deployments, DaemonSets, StatefulSets, ReplicaSets, Jobs and
CronJobs. Only one overview page is in flight at a time, with at most five pages
and 500 loaded items per kind, including the separate Event inventory. Pages over
100 items, duplicate identities and repeated continuation tokens are rejected.
Unconsumed continuation or server truncation means partial, not a complete total.
Refresh retains same-scope data as stale; namespace/session changes clear scope
and cancel the pending read. Failures do not become zero healthy resources.

Status follows actual projected facts: Pod health/terminal phase, observed ready
versus desired replica counts, terminal Job conditions/completions, and CronJob
suspend/active facts. Unknown Running metadata is not evidence of readiness.
Active/Unknown donut segments are neutral; Ready/Completed use success,
Not ready/Pending/Suspended warning and Failed error. This donut mapping is not
identical to the shared text badge mapping.

Latest events shows ten entries within loaded pages, ordered by last occurrence
then creation fallback, not cluster-wide latest events. Columns are Type,
Message, Namespace, Involved object, Source, Count, Age and Last seen. Age is
since creation; Last seen is since the reported occurrence. Rust prefers series
count/lastObservedTime and falls back through legacy Event fields; missing or
invalid facts remain Unknown. `resources.rs` filters control/bidi characters and
caps selected text at 256 UTF-8 bytes. Messages and source names may still contain
sensitive cluster text: no blanket secret-free guarantee. Related links use
validated Rust identities, never guessed object paths.

Acceptance: `tests/workloads-overview.spec.ts` also contains
`event relationships resolve through the backend instead of guessing object identities`,
`rejects oversized API pages instead of inventing an unbounded total`, and
`empty inventories show zero donuts without claiming healthy resources`.
Rust `connection/resource_tests.rs` contains
`event_projection_bounds_messages_and_prefers_reported_occurrences`,
`event_projection_validates_timestamps_and_preserves_missing_facts`, and
`workload_overview_projects_observed_readiness_and_terminal_job_conditions`.

## CRD-only transport allowance

CRD LIST starts with `limit=10` under the ordinary 2 MiB body bound. On
`LimitExceeded`, Rust retries the same unconsumed continuation token with
`limit=1`, allowing at most 16 MiB for that CRD single-object response. Subsequent
pages in that read retain the reduced limit. Ordinary kinds retain their existing
body limits. Projected CRD items have a separate 64 KiB per-page and accumulated
scan budget; this is not a new global IPC-response cap. Oversized single objects,
ignored limits, repeated tokens and failed retries fail explicitly. Schemas and
webhook payloads are not sent to the renderer. The detail-facts budget described
in [resource inspector reference](resource-inspector-reference.md) is separate.

## Verification status

### Current search, theme and toolbar changes

These are Iceon-specific refinements against the same recorded upstream commit,
not copied upstream code or newly established parity:

- `src/app/cluster/useDebouncedSearch.ts` commits controlled drafts after 160 ms.
  Resource-table reads cancel obsolete requests before debounce completes; pending
  drafts retain stale rows and disable pagination, selection/mutations and other
  scope-dependent actions. Catalog, cached Helm and forwards use deferred local
  filtering with memoized searchable fields/table rows. Namespace options search
  the loaded cache locally. `RowContextMenu.tsx` memoizes row/action fingerprints;
  it does not stringify the entire inventory for each typed character.
- `ContentLoading.tsx` uses a named Astryx spinner centered in the first-load
  content region. With retained rows, a nonblocking bar sits below filters without
  moving them; errors and stale notices remain. Reduced motion stops animation.
- `PreferencesProvider.tsx` controls the root Astryx Theme inside its context from
  persisted Light/Dark/System. Save applies changes; draft edits, Cancel and failed
  Save do not change the active mode. Initial loading is asynchronous, not a
  no-flash guarantee.
- `AppToolbar.tsx` puts Refresh immediately after Go forward, then Switch cluster
  on cluster routes. Preferences/Search are named icons with narrow-window overflow
  entries. The inset sidebar does not repeat the cluster name. The cluster selector
  resolves saved IDs, preserves a validated section and reports missing metadata.
- The Azure palette under `src/themes/azure/` was generated through Astryx CLI
  from `#0074e2`; its config/receipt records the seed. `src/themes/brand.ts` maps
  mode-specific accent, on-accent, muted, text and icon roles while extending
  neutral. Neutral surfaces, green semantic success statuses and black log
  surfaces remain intact, rather than recoloring all roles blue.
- `MainLayout.tsx`, `CatalogSidebar.tsx`, `ClusterSidebar.tsx` and
  `sidebar-motion.css` animate navigation width/opacity while retaining route
  context. Exiting cluster navigation is inert and accessibility-hidden; reduced
  motion disables transitions. `tests/sidebar-motion.spec.ts` maps these behaviors
  to browser fixtures, not native animation proof.
- Show saved metadata in `ClusterWorkspacePage.tsx` opens an Astryx Dialog with
  labeled saved fields, Escape and focus return, not an inline metadata panel.
  `tests/metadata-dialog.spec.ts` is the acceptance source; saved metadata is not
  evidence of a connected cluster.
- The GitHub icon immediately before More calls no-argument
  `project_open_repository` through `src/app/project/api.ts`. Rust
  `src-tauri/src/project.rs` fixes the target to `https://github.com/yan-ad/iceon`,
  without renderer-provided URLs or arbitrary opener access. Browser preview
  disables opening; native failures expose only a safe message. Acceptance:
  `tests/project-repository.spec.ts` and `project.rs` unit tests.

Acceptance sources: `tests/search-performance.spec.ts` (cached filtering, burst
coalescing, selection reset and held-read cancellation),
`tests/search-responsiveness.spec.ts` (keyboard text retention, late results and
namespace changes during debounce), `tests/loading-feedback.spec.ts` (initial,
retained, reduced-motion and failed refresh), `tests/theme-appearance.spec.ts`
(saved modes, portals/reload, Save/Cancel/failure and live System changes), plus
`tests/connected-toolbar.spec.ts` and `tests/window-layout.spec.ts` (toolbar bounds
and overflow). Test names describe fixture obligations, not measured FPS or native
OS verification.

The connected toolbar reserves macOS right clearance without adding another row.
At compact widths the text badge is replaced by semantic color on the existing
Cluster actions icon; its tooltip, accessible description and disabled status
menu item retain the full connection label. At wider widths the badge cannot
shrink into an unlabeled pill. `tests/connected-toolbar.spec.ts` checks the
connected layout at 360–1440 CSS pixels and normal/enlarged root text sizes.

Historical verification before the current search/theme/auth fixes: `bun run build` passed (with Vite's large-chunk
warning), the complete browser suite passed 619 tests, Rust passed 216 tests,
and formatting plus strict all-target Clippy passed. Both staged and unstaged
diff whitespace checks passed. Synthetic browser IPC and fake-service tests do
not prove native window controls, OS/webview editing, production-cluster outcomes
or full upstream behavior. No native smoke test was performed and no real
kubeconfig or credentials were read.

Historical verification (2026-10-26, before automatic refresh/navigation/prerelease changes): the complete browser suite passed
650 tests, Rust passed 230 tests, and build, formatting, strict all-target Clippy,
and staged/unstaged whitespace checks passed. Vite retains its large-chunk warning.
The Rust-to-renderer contract covers all 41 resource detail projections, including
RBAC path-segment names. The shared Tauri state-type regression is a source-level
invariant, not native dispatch coverage. No real credentials, live cluster
operations or native smoke tests were used. See [credential renewal](credential-renewal.md)
for the separate Rust authentication contract and its fixture mapping.

Current full-suite validation is pending. Do not carry the historical 650-browser/
230-Rust totals forward or describe a planned browser run as passed.
This documentation pass checked source, not native windows or real clusters.

`tests/node-search-rendering.spec.ts` addresses the latest CI budget issue by
removing forced 4x CPU throttling from the normal run, not by skipping/retrying
tests or raising timeouts. Optional local stress remains available with
`ICEON_NODE_SEARCH_CPU_RATE=4 bun run test:e2e tests/node-search-rendering.spec.ts`.
The regression still records all 20 sequential input events against 100 rows,
checks zero additional table-body renders during the pending draft after its
initial invalidation, and verifies no draft IPC plus exactly one committed query.
It is render isolation evidence, not an FPS or shared-runner latency guarantee.

## Prerelease and CI scope

See [release and installation instructions](releases.md) for `0.0.1`.
The unsigned route builds only an Apple Silicon DMG, using ad-hoc signing rather
than Developer ID or notarization. Updater public key/endpoints are empty; no
updater manifest, archive or signature is published. Foreground inventory polling
is independent of application updates, which remain disabled for this unsigned release.

CI configures Rust checks on macOS and Linux and eight parallel Chromium fixture
shards on Linux. Rust exports the real detail-contract artifact once; the browser
contract test verifies its commit instead of invoking Cargo in a browser worker.
Each shard prints individual test progress, preserves failure traces and has an
eight-minute suite deadline inside a ten-minute Actions test step. Setup and
test timeouts remain distinct; no tests are skipped to accelerate the release.
The unsigned
tag workflow waits for CI and exact tag/manifest checks, builds and verifies the
app/DMG, creates a draft, verifies downloaded uploaded assets/checksums, then
publishes a prerelease marked not latest. These are configured checks, not a claim
that a release has run. Installation requires trusting the release, checking its
checksum, copying to `/Applications` and following the README's app-scoped
quarantine instruction; never disable Gatekeeper globally.

The separate manual [release dry run](release-dry-run.md) runs full reusable CI
before building and statically inspecting an ARM64 ad-hoc app and headless DMG.
It has read-only contents permission, no publication/tag/version changes or
signing secrets. Its seven-day Actions evidence is not confidential in a public
repository. Native picker, actual-cluster and installation smoke tests remain
unperformed; current full-suite results will be recorded after verification.
