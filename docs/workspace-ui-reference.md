# Workspace UI reference

## Source and scope

Behavior reference: local `/Users/user1/Kerjaa/freelens`, Git HEAD
`cd07118f843c4a69f937a319a37a7c12ef2c92d8`, described as
`v1.10.3-533-gcd07118f`. HEAD and the paths below were checked through Git;
referenced components were read. Paths in the source column are relative to
`packages/core/src/renderer/components/`. Icekube keeps Astryx and Rust/Tauri;
this is not full Freelens parity, extension compatibility, or adoption of its
Electron/Node runtime. No upstream implementation was copied in this documentation pass.

| Workflow / upstream source | Expected Icekube interaction and owner | UI states / acceptance mapping |
| --- | --- | --- |
| Catalog: `catalog/catalog-add-button.tsx` | Add config and Add web link are separate named icon buttons at bottom right in `CatalogPage.tsx`/`CatalogForms.tsx`, outside table scrolling. Refresh stays beside Search in `AppToolbar.tsx`. Rust `catalog.rs` owns import, persistence and saved links. | Unavailable/loading disables actions; forms retain safe validation errors; Escape returns focus. `tests/catalog.spec.ts`: `bottom catalog actions support keyboard dialogs while Refresh stays beside Search`; parameterized `${category}: bottom actions clear the table and viewport at desktop and narrow widths`. |
| Table selection: `item-object-list/header.tsx`, `item-object-list/list-layout.tsx` (table composition reference; exact heading substitution is Icekube-specific) | `ResourceSelection.tsx` puts selected count and Clear selection in the first data heading after the checkbox. Other heading labels are visually hidden with opacity, not removed; accessible labels and column widths remain. Focused heading controls become visible. Rust deletion services retain UID/version precondition ownership. | None/selected/mixed header, scope reset, disabled unsafe identities. `tests/table-composition.spec.ts`: `${view.label}: selection replaces only heading labels without moving columns`, `filter scope clears selection and restores header labels`. |
| Semantic color: `workloads-overview/overview-workload-status.tsx` (status-chart reference; Astryx badge mapping is local) | `StatusBadge.tsx` maps recognized positive labels to success, failed labels to error, pending/degraded labels to warning. Unknown strings and generic booleans stay neutral. Node Ready=True is success, Ready=False error, positive pressure conditions warning. Rust supplies observed facts; renderer colors do not establish connection/health. | Explicit positive/negative/unknown values in both themes. `tests/semantic-status.spec.ts`: `semantic statuses use Astryx variants without interpreting generic booleans in ${colorScheme}`; `tests/table-composition.spec.ts`: `Pod health uses semantic success and warning colors`. |
| YAML: `dock/edit-resource/view.tsx` (upstream EditorPanel, not CodeJar) | Icekube `YamlEditor.tsx` uses locked CodeJar 4.3.0 and highlight.js YAML browser modules. Actual callers: `PodDetailsView.tsx` (YAML), `ResourceCreate.tsx` (Resource YAML), `HelmInstall.tsx` (Values YAML). Rust `connection/pods.rs`, `connection/create.rs` and Helm services own data, validation and mutations. | Editable/read-only/busy, external value updates, caret/IME, escaped source, disposal. `tests/yaml-editor.spec.ts`: `real CodeJar highlights escaped source and exposes a named multiline editor`, `read-only YAML preserves serialization and rejects keyboard, paste, cut and undo`, `composition is not highlighted or published mid-IME, and commits once`, `unmount removes handlers and pending callbacks cannot publish`. |
| Details sidebar: `kube-object-details/kube-object-details.tsx`, `drawer/drawer.tsx` | `ResourceInspector.tsx` owns a nonmodal, layout-flow sidebar with a separating border, named Refresh/Expand/Restore/Close icons, pointer capture and keyboard resize. Rust `connection/details.rs`/`pods.rs` own scoped reads and cancellation. | Loading, missing/replaced, permission/error, retained stale, open/closed/expanded/dragging; `tests/inspector-resize.spec.ts`: `opening, dragging and expanding reflow the workspace, restore retains the dragged width`, `separator keyboard bounds and reduced motion remain usable on narrow windows`, `close immediately disposes pending content while an empty inert shell collapses`, `pointer cancellation and route disposal end dragging without late detail revival`. |
| Workloads overview: `workloads-overview/overview.tsx`, `overview-statuses.tsx`, `overview-workload-status.tsx` | `WorkloadsOverview.tsx` shows seven status donuts from Rust `connection/transport.rs` LISTs and `resources.rs` projection. Namespace and Refresh restart scoped reads. Category links open their resource tables; event links resolve identity through Rust detail relationships. | Loaded/zero/loading/partial/stale/permission/error remain separate. `tests/workloads-overview.spec.ts`: `uses real loaded counts and never turns unknown Running metadata green`, `bounds pagination and isolates per-kind permission errors`, `refresh retains stale inventory on failure and empty results remain explicit`, `cancels the exact pending read on namespace change and ignores late completion`. |
| CRDs: `custom-resource-definitions/view.tsx`, `details.tsx`; `custom-resources/details.tsx` shows upstream instance behavior outside current scope | Icekube lists and inspects allowlisted CRD facts. Rust `connection/transport.rs` handles adaptive page fetches; `resources.rs` and `detail_facts.rs` project bounded facts. Custom instances and dynamic schema browsing are not implemented. | Permission/unavailable/error/cancel/partial continuation, no fabricated empty success. `src-tauri/src/connection/crd_fetch_tests.rs`: `crd_large_schema_retries_same_opaque_token_at_one_and_projects_only_facts`, `crd_filtered_scan_retries_without_skipping_and_resumes_at_unscanned_token`, `crd_single_object_cap_and_ordinary_inventory_budget_remain_enforced`, `crd_retry_failure_is_not_an_empty_or_partial_success`, `crd_cancel_during_retry_releases_engine_read_slot`, `crd_single_retry_rejects_ignored_limit_and_repeated_tokens`. |

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

The connected toolbar reserves macOS right clearance without adding another row.
At compact widths the text badge is replaced by semantic color on the existing
Cluster actions icon; its tooltip, accessible description and disabled status
menu item retain the full connection label. At wider widths the badge cannot
shrink into an unlabeled pill. `tests/connected-toolbar.spec.ts` checks the
connected layout at 360–1440 CSS pixels and normal/enlarged root text sizes.

Verification for this change set: `bun run build` passed (with Vite's large-chunk
warning), the complete browser suite passed 619 tests, Rust passed 216 tests,
and formatting plus strict all-target Clippy passed. Both staged and unstaged
diff whitespace checks passed. Synthetic browser IPC and fake-service tests do
not prove native window controls, OS/webview editing, production-cluster outcomes
or full upstream behavior. No native smoke test was performed and no real
kubeconfig or credentials were read.
