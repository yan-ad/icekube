# Inspector, overview and allocation readability follow-up

Date: 2026-10-30. The initial audit was requested before implementation. The user subsequently requested implementation, workload/event interaction refinements, compact legends and reduced header whitespace, and explicitly approved committing/pushing and replacing the failed unpublished 0.0.8 tag only after checks pass.

## Implemented findings

1. Memory usage now uses a shared `UsageBar` with a theme token fill distinguishable from the rail. Numerical used/allocatable values and unavailable states remain. Both themes have computed fill/track contrast tests at zero, 25%, 100% and over-capacity. Requested allocation is not fabricated from usage or capacity.
2. `SupportingSection` groups inspector facts, labels, annotations, managed fields, Pod sections, Helm history and diagnostic text in flat Astryx cards. Headings remain inside their section. `DetailList` retains panel-width-aware two-column/one-column behavior. Primary inventory tables are not wrapped in new cards.
3. Secondary condition/event tables and related-resource collections share the same card treatment, including their local loading/empty/error/retry states. Existing UID/scoped navigation, cancellation and mutation safeguards remain.
4. Routine explanations use named information popovers; adverse read states and redaction warnings remain inline. Workloads header/refresh feedback share one stack, avoiding an extra empty-slot gap.

## Workload presentation refinement

Reference: local Freelens commit `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, recorded in `docs/workspace-ui-reference.md`. No upstream implementation was ported. Iceon keeps Astryx and Rust-owned cluster IO.

Lifecycle labels now use Running/Pending/Succeeded/Failed/Terminating/Scheduled/Suspended where facts substantiate them. Unknown desired replica counts remain Unknown. Controller counts use projected replica counters, not Freelens's associated child-Pod phases; failed Job attempts do not establish terminal failure. Cross-time snapshots of the same kubeconfig need not have equal totals.

Legends are compact square color keys with text, not rounded badges or colored edge pills. They remain keyboard-operable pressed buttons, reveal percentages, toggle chart segments and retain total counts. Long labels wrap in auto-height controls. Chart/title links navigate to the matching inventory. The heading-to-first-card gap is explicitly regression-tested.

Events are sequentially bounded to 20 pages/2,000 records and display ten rows per page. Default order is newest creation (Age), with separately sortable Last seen. Sorting applies across all loaded rows before paging, uses displayed fallback Types, and leaves unknown timestamps last in either direction rather than inventing last-occurrence time from creation. Warning message text uses the defined Astryx `--color-text-red` token in both themes. Scoped details, object/namespace navigation and existing row menus remain.

## Release-CI root causes and repairs

- Browser fixtures had stale IPC mocks after namespace-cache and inspector collection additions, outdated action/overflow labels and ambiguous Namespace/Namespace options selectors. Strict request/identity and no-unexpected-IPC assertions remain.
- Two updater harnesses parsed Vite-transformed imports with regular expressions. A typed test module now imports React and Astryx's theme subpath directly. Using the root Astryx barrel caused a cold optimizer-generation/duplicate React hook failure in the first shard attempt; using the same theme subpath as the app removed that cause. No app runtime workaround or CSP change was made.
- Related-collection contract tests compiled Rust inside browser runners without native GTK development packages. CI now exports the real seven collection projections in its Rust job alongside the 41 detail projections. Browser shards check the exported commit identity and cannot compile a fallback under CI. Local tests can invoke the real Rust exporter.
- A short-lived cache fixture could expire before uncached review transport started under scheduler load. The test now waits for exactly two uncached transports, advances paused time, then releases them, preserving rejection of cached permission expiry before publication. Two-permit batch fixtures are serialized with a test-only mutex so they cannot each hold one global review slot while waiting for a second. Runnable, wall-clock-bounded waits prevent paused clocks from timing out during unrelated test-runtime contention; cancellation cases resume time between iterations. Production concurrency is unchanged.
- A shell printf loop competed with a tight output-limit test timeout. A fast synthetic byte producer and a separate bounded test deadline distinguish output-limit behavior from the explicit timeout case. Production process limits were not changed.

## Validation record

- Frontend production build and five Bun tool tests passed; the existing large-bundle warning remains.
- All 473 Rust backend tests passed with default concurrency after synchronization; backend strict all-targets Clippy passed. Formatting checks passed.
- Release tooling: 16 xtask tests, strict Clippy and 18 Python publisher tests passed.
- All 13 focused workload tests passed, including both themes, long-label/narrow reflow, event sorting/paging, keyboard legend toggles, warning color, heading spacing and unknown-time ordering.
- All 29 updater/performance tests passed; 120 unchanged polls caused zero consumer rerenders in the measured fixture cases. This does not establish native CPU savings.
- Earlier dedicated detail/overview runs passed their corrected cases, including measured memory contrast, panel-width/200% text reflow and keyboard popover dismissal/focus return.
- All six synthetic development-engine browser tests passed, using the test configuration's temporary discovery home and kubeconfig, not the user's home.
- A monolithic browser run reached approximately 845 cases without recorded assertion failures before SIGKILL. It is **not** a complete passing run. An initial sharded run found the cold updater import issue described above; another attempt had a shared Vite port-start collision before testing. Neither is counted as green. Final CI-style shard results: **1,176 passed, four production-only cases skipped**, across eight bounded shards (147 passes in each). Shards 1–7 passed after the fixture fixes. The initial final-shard attempt found two broad Helm identity selectors and a history-note assertion still assuming inline prose; scoped region/popover assertions fixed these without weakening exact Helm IPC checks. The complete rerun of shard 8 passed. An additional eight Node/Pod/Helm detail-column cases passed after removing unrelated metadata/badge height overrides accidentally introduced during legend wrapping work. Concurrent local shard lanes previously exhausted suite/teardown budgets; isolated reruns passed with the original limits unchanged. One isolated Node fixture load failed with `ERR_NETWORK_CHANGED` and an empty DOM; its unchanged rerun passed. None of these incomplete attempts is counted as green.

All automated checks use synthetic metadata/mocked IPC or Rust test fixtures, not real kubeconfig, credentials or live GKE. No native macOS/Windows window, installation or update smoke check is claimed. Original failed tag identity and the approval-limited lease-based recovery plan are recorded in `docs/releases.md`; no published tag or asset may be replaced.

## Cross-platform CI follow-up

Commit `e27c0c9` passed macOS/Linux Rust, Windows x86 compilation and seven GitHub browser shards. Shard 2 found a real two-pixel overlap between the update-error icon and GitHub button at 360px with 125% root font on Linux. The ready-state restart button's padding exhausted the remaining shrink budget. Narrow toolbar CSS now reduces only that button's inline padding to the existing spacing-1 token, retaining the fixed error indicator, label, tooltip and keyboard action. No test overlap tolerance, native clearance, CSP or production process limit changed. All 43 connected-toolbar/updater checks and the production build passed locally after this fix; fresh GitHub CI remains required before tag replacement.
