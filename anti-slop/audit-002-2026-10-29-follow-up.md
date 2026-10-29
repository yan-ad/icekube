# Resource loading and toolbar follow-up

## Findings addressed

- Removed NamespaceSelector's duplicate standalone spinner; the selector retains its built-in progress indicator and a named hidden loading announcement.
- ContentLoading explicitly fills the remaining content space and shows the operation label below the centered Astryx spinner. Retained snapshots still use the existing nonblocking progress bar; failures and successful empty results remain distinct.
- TableToolbar no longer overrides search with flex growth. Its direct search fields use an 18rem width capped by available space, aligned with other controls at the right. Controls wrap inside the page rather than being clipped behind horizontal header scrolling.
- Resource and Helm namespace selectors occupy the context area beside the title. Discovery denial, unverified state, partial/empty results, errors, retry, and manual namespace entry are in feedback below that row. NamespaceSelector keeps inline feedback by default for forms and other callers. Known namespace input also submits a valid name with Enter.

No permission decisions, request ownership, namespace subscriptions, IPC contracts, Rust logic, generated theme files, dependencies, or real credentials were changed for this fix. Existing colors/type/icons/layout direction remain ENERGY 1 / RHYTHM 1 / MOTION 1.

## Evidence

Before implementation, resource-toolbar regressions reproduced two visible namespace spinners and the narrow search field outside the viewport. A subsequent wide-layout assertion caught the search/status group wrapping because percentage input sizing underestimated its natural width. The bounded explicit input width fixed that root cause; temporary diagnostics were removed.

`tests/resource-toolbar.spec.ts` covers, in light and dark:

- Delayed permission review: named checking status, editable compact search on the right, one visible namespace indicator.
- Delayed namespace/resource reads: centered visibly named loader; successful empty response removes progress without moving the search row.
- Initial resource failure: no loading indicator or fabricated empty table; Refresh retries and restores the actual table.
- Unverified namespace discovery: real warning retained, manual entry below title/search at 1568, 900, 640 and 360 widths; search stays visible/focusable and the document does not overflow horizontally. Enter applies a known namespace; explicit Load namespaces remains callable.

Screenshots from the isolated Chromium run were inspected for light/dark wide loading and dark narrow fallback. The search occupies a compact right-hand area; the resource loading state occupies the content center. Narrow fallback controls wrap and all access warnings remain visible. Existing loading-feedback tests cover retained rows, failed refresh, and reduced-motion progress. No independent numerical contrast audit is claimed; existing theme tokens are unchanged.

The 154-test integration run passed across Catalog, loading feedback, namespace selector, permission actions, resource tables, service tables, and the new toolbar regressions. Build and git diff --check passed with Vite's existing large-chunk warning. The follow-up run passed all 125 tests across centered errors, resource creation, Helm installation and all six toolbar regressions, including resource failure/retry and Enter-key namespace entry in both themes.

These are browser tests using synthetic IPC, not live-cluster or native-webview certification. No real Kubernetes API, credential reads, native-window/zoom/fullscreen verification, or Rust suites were run for these presentation-only changes. The local reference checkout was not available; this adjusts existing Astryx layouts to the supplied screenshots rather than adapting another upstream workflow. No commit was created, and unrelated working-tree changes were preserved.
