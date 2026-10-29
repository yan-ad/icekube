# Sidebar audit follow-up

The user approved findings 1 and 2 and the in-memory alternative to a temporary file.

## Implemented

1. PermissionStore keeps a bounded navigation-only projection for the static navigation check set. It is cleared on cluster/session replacement, release, and observed authorization-epoch change. First reviews are awaited; subsequent expiry/retry/unavailable responses retain the previous visibility. Explicit allowed/denied results update it. The operation cache still expires to Unknown and is not replaced by this projection. No filesystem, localStorage, IPC schema, or Rust authorization change was made.
2. ClusterSidebar uses the existing Astryx SideNavItem without href/onClick for grouped rows. Its built-in disclosure handles the entire label/chevron row with one focus target. Leaves still navigate. Legacy direct parent URLs remain compatible. DestinationGrid passes cluster identity to the shared navigation projection.

## Delivery checks and click-through evidence

- Workloads, Config, Network, Storage, Helm, Access Control, Custom Resources labels: click expands/collapses children without changing the URL or showing a landing directory (`cluster-navigation.spec.ts`).
- Parent button Enter/Space: toggles expansion; Tab reaches children; child Enter navigates and exposes the selected page (`cluster-navigation.spec.ts`).
- Every fixed child destination: existing table or supported destination content opens; direct links/reload/history restore the selected ancestor (`cluster-navigation.spec.ts`).
- Narrow drawer: parent Space leaves it open; child Enter navigates and closes it; Escape dismisses it; no document overflow at 360-wide viewport (`cluster-navigation.spec.ts`).
- Denied Nodes: absent during the first delayed review, stays absent across Pods/Events navigation and delayed expiry renewal in both light/dark schemes, and reappears on a subsequent explicit allow. These tests also assert no page errors and no extra session opens during navigation (`permissions.spec.ts`).
- Review failures/retries/Unknown: retain prior navigation visibility without a stale operation grant; other cluster IDs, replacement sessions, observed epoch changes, and release invalidate projection (`permission-navigation-cache.spec.ts`).
- Existing permission batching, expiry, exact cancellation/late replies, namespace-local fallback, denied/unknown mutation gates, custom-resource discovery, reduced motion and inert exiting/collapsed navigation checks passed in the isolated browser run.
- Build passed with Vite's large-chunk warning; `git diff --check` passed. Rust was not changed, so Rust suites were not rerun.

## Verification limits

Tests use synthetic IPC responses and browser Chromium, not real kubeconfigs, live cluster requests, or native window interaction. Existing theme tokens/layout are unchanged; no independent numeric contrast audit or native zoom/fullscreen test is claimed. The local Freelens checkout was absent; the pre-existing pinned upstream reference was not freshly verified and no upstream code was copied.

A broad 156-test integration run initially had 150 passes and 6 failures. Two old interaction expectations were updated for this feature (parent route links and disconnected unreviewed Nodes). The other four failures involved additional namespace discovery reads present in concurrently changed dock code: three cluster connection exact-read expectations and the Namespaces registry test's expected first-page request. Those unrelated implementation/test expectations were left untouched. Parallel Playwright output collisions were eliminated for this task by using a dedicated temporary configuration, port, and output directory. The final focused run passed all 51 tests across permission, navigation, motion, custom-resource, permission-action, and Catalog activation suites. The updated disconnected direct-route connection test then passed separately (52 targeted tests total). The final build and diff checks passed.

No new visual techniques, assets, dependencies, or claims were added. DESIGN.md direction remains ENERGY 1 / RHYTHM 1 / MOTION 1. A source review found a pre-existing accumulation of dynamic custom-group collapse keys; it was not part of the approved fixes and remains unchanged.
