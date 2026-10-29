# Section pin review (2026-10-29)

Mode: review after implementation. No optional visual fixes applied pending approval.
Scope: cluster-navigation pin actions and Catalog shortcuts, not a whole-app redesign.
Direction: preserve DESIGN.md's compact Astryx shell, existing spacing, navigation and persisted cluster colors.

## Findings

1. **HIGH, R-03: compact touch targets.** The new actions inherit Astryx's small sidebar control size, consistent with existing controls but below the skill's 44-pixel mobile target recommendation. Consider a touch-specific target treatment without widening desktop navigation. No styling adjustment applied.
2. **LOW, R-31/C-4: expanded labels truncate early.** Cluster-plus-section names distinguish saved targets but truncate in the existing narrow sidebar, particularly with trailing Unpin. Complete accessible names and collapsed tooltips remain available, and destination icons identify the requested sections. Consider section-first visible text or a richer tooltip if preferred. No label-order change applied.

## Gate evidence

- PASS, R-24/R-26: static shortcut routes use exact cluster IDs and section search parameters; Pin/Unpin invokes a Rust-owned persistence command. Workloads directory, Pods, Namespaces and independent cluster targets exercised.
- PASS, R-27: saves disable concurrent actions; failed saves retain previous shortcuts and display the existing error. Invalid pin responses are rejected. Existing loading/empty/browser-unavailable states preserved.
- PASS, R-32: keyboard Pin and shortcut activation, disclosure Tab order, and narrow drawer Escape tested.
- PASS, R-03 layout: 360-wide drawer has no document-level horizontal overflow; 200% root text and long names remain operable at desktop width. Touch-size finding remains open, so this is not a blanket accessibility sign-off.
- PASS, R-34: light/dark screenshots and computed color equality verify section icons use the existing cluster color renderer. No independent WCAG color-conformance claim is made for arbitrary persisted record colors.
- PASS, R-35 feature scope: production build succeeds; all six section-pin tests pass; catalog/navigation regression tests passed separately. Rust formatting, 365 tests and Clippy passed.
- PASS, purpose: Pods cube depicts the resource, Workloads packages and Namespaces sitemap reuse the established navigation vocabulary. Color identifies cluster ownership, not decoration. No new CSS, palette, animation, badge, font, native chrome or runtime dependency.

## Validation limits

The broad 890-test browser run was stopped after failures outside pin-specific code paths. Trace evidence included a failed Vite React dynamic import, an absent update-harness control, stale-session resource-count mismatches, and a Config navigation timeout under load. No clean pre-change baseline was established, so these are unresolved broad-suite failures, not asserted pre-existing defects. Config navigation passed in the isolated regression run.

Native Tauri window behavior, actual cluster access and real credentials were not exercised. Browser tests use synthetic metadata and mocked IPC; Rust tests use fixture files and temporary databases. No upstream section-pin parity is claimed because the local Freelens checkout was unavailable.
