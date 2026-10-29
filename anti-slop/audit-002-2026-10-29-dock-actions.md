# Dock actions UI review

Scope: the new dock **New tab** menu, **New Terminal** target dialog, and **Create Resource** picker. Review performed after implementation, as requested. Existing Astryx layout, typography, colors, and icons remain the design source; no redesign or dependency installation was performed.

## Result

No blocking visual or keyboard issues found in the reviewed scope. The compact two-item menu opens above the dock's + trigger and remains inside a 390-wide viewport in light and dark themes. Browser screenshots were inspected; keyboard opening, Escape dismissal, and focus return are automated. The action remains available with no tabs, alongside existing tabs, and when the dock is minimized. Existing resize, maximize, tab navigation, narrow layout, and stream-cleanup tests remain passing.

## Advisory finding — not implemented

- **LOW: Pod name entry requires knowing the target name.** `src/app/cluster/DockActions.tsx` uses explicit namespace and Pod-name input, prefilled from the active dock tab when available. A future bounded, permission-aware Pod picker could help users starting from an empty dock, with explicit loading, empty, failed, partial, and retry states. This would need its own scoped Rust inventory/cancellation behavior; no new inventory fetch or speculative list was added for this request.

## Implementation decisions

- Keep a single compact + action beside sessions instead of adding another toolbar or permanent labeled buttons.
- Preserve the requested action names, with explicit dialog copy that New Terminal opens a Pod shell, not a host terminal. Container choice and execution reuse the existing Rust-owned session path.
- Reuse the existing resource editor, namespace-specific authorization checks, server dry-run, and exact confirmation rather than introduce a second creation implementation.
- Keep notices textual and scoped to the current workspace. No new colors, CSS imports, raw layout elements, or fake terminal output.

## Correctness validation

Implementation testing found and fixed two regressions before delivery: closed dialogs mounting hidden namespace controls, and category-page creation invoking a connection-level refresh that would close existing streams. Regression tests cover conditional dialog mounting, pending-request session disposal, late result rejection, and creation on a category page without reconnecting.

Screenshots: `/tmp/iceon-dock-regression-final/` contains the light/dark menu captures produced by the theme tests. Relevant acceptance coverage is in `tests/pod-workspace.spec.ts` and `tests/resource-create.spec.ts`.

Limitations: browser automation uses fixture data and mocked IPC. No real kubeconfig, cluster, host shell, or native window was accessed. Screenshots are a visual review, not a measured WCAG contrast certification or a native OS smoke test. Advisory UI changes await approval.
