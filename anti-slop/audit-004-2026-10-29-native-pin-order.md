# Native pin menus and saved ordering review

Date: 2026-10-29. Mode: review after implementation. Direction: requested fixed icon-only Catalog sidebar, existing Astryx shell and record colors; no new palette or typography.

## Findings awaiting approval

1. LOW, C-4/R-32: icon-only shortcuts rely on tooltips, accessible names and contextual actions. Their accessible description advertises right-click, Shift+F10, drag and Alt+Arrow movement, but there is no persistent visual instruction. Consider an optional first-use hint if discoverability becomes a reported problem. No extra UI added.
2. HIGH, R-03: the existing compact sidebar icon targets remain below the skill's 44-pixel mobile recommendation. The sidebar-local narrow drawer launcher preserves reachability but does not constitute a touch-target redesign. Earlier compact-target findings remain open.

## Feature gate evidence

- PASS, functional controls: right-click dispatches a validated saved pin to Rust's native Menu/ MenuItem implementation, not a renderer menu. Unpin removes the exact cluster, web-link or section target without route activation or external opening.
- PASS, keyboard: Shift+F10/Context Menu invokes the menu; Move up/down and Alt+Arrow provide alternatives to dragging. Reordering restores focus to the moved shortcut.
- PASS, persistence: Rust validates exact pin permutations; SQLite schema 4 upgrades schemas 1/2/3 transactionally. Mixed ordering survives restart; unpin/re-pin appends; stale or removed targets reconcile without unrelated data loss. No kubeconfig reads happen on menu validation or reordering.
- PASS, lifecycle: native requests are window-bound, one-shot, random-ID scoped and bounded to 30 seconds. Navigation, pin-list changes, cancellation and disposal invalidate late UI replies. Window destruction/shutdown release native owners.
- PASS, honest states: failed saves retain saved order and existing errors. Dismissed menus do not mutate; malformed replies fail closed. The fixed sidebar has disabled empty/loading indicators. Menu failures render an accessible bounded alert rather than widening navigation.
- PASS, layout: no toolbar collapse control; no legacy collapse preference reads/writes. Narrow windows keep an icon sidebar and a sidebar-local drawer launcher. Catalog bottom action geometry was tested at 1100, 800 and 360 widths after fixing the new flex wrapper's content-sizing issue.
- PASS, purpose: existing section icons identify destinations, record colors identify ownership, and token-based drop outlines identify placement. Native chrome clearances and drag regions were not redesigned. Tauri's native file-drop handler is disabled to permit HTML dragging on Windows; permissions/CSP remain unchanged.

## Validation limits

Production build passes with the existing bundle-size warning. Rust formatting, all 410 tests, and all-target Clippy with warnings denied passed on the current working tree. Browser automation uses synthetic metadata and mocked IPC, not real native popup interaction.

The serialized 74-case browser run passed 71 checks, including all dedicated pin-menu/reordering cases. Config and both light/dark section navigation cases exceeded the default 30-second test budget. All three passed on an isolated rerun with a 120-second budget, completing in 16.2, 6.1 and 6.9 seconds respectively. Thus all 74 feature-scope cases passed across the original run and rerun, not in one clean default-timeout run. Earlier mixed runs also encountered update-indicator expectations changing concurrently with updater code; those failures are not claimed resolved by this feature.

Actual native menu appearance, pointer dragging, native control/resize/fullscreen behavior across macOS/Windows/Linux were not manually tested. No real kubeconfig, credential or cluster access was used, and no upstream Freelens workflow parity is claimed.
