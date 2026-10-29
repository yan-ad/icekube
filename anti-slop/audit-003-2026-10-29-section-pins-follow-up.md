# Section pin follow-up (2026-10-29)

Scope: requested hover visibility, pin-before-chevron placement, Config child controls, and duplicate cluster shortcuts.

## Changes verified

- PASS: unpinned actions are hidden until their row is hovered or keyboard-focused; pinned actions stay visible. Devices without hover retain visible controls.
- PASS: Workloads pin lies before the expand/collapse chevron in light and dark browser tests. Clicking the moved chevron still expands the group; Pin does not expand it or navigate.
- PASS: Config Maps has the same hover pin action and produces the correctly scoped shortcut. Other static Config children share that renderer.
- PASS: Cluster/overview uses the Catalog cluster pin. Legacy overview pins are validated, folded into the existing cluster pin on load, omitted from section shortcuts, and persisted canonically on the next save. Unpin/restart cannot resurrect a duplicate.
- PASS: existing icon/color equality, keyboard navigation, failure retention, narrow drawer, long names, and enlarged-text tests remain green.

## Verification

- `bun run build`: passed; bundle-size warning remains.
- Focused browser run: 44 passed across section-pins, cluster-navigation, catalog, and catalog-activation.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 366 passed.
- Cargo formatting, all-target Clippy with warnings denied, and `git diff --check`: passed.
- Expanded light-theme screenshot reviewed; unpinned rows are visually quiet and the Workloads pinned action precedes its chevron.

No optional redesign was applied. Earlier compact-touch-target and truncated-label findings remain open. Browser tests use mocked IPC and fixture metadata; native OS behavior and real-cluster access were not exercised. The earlier broad browser-suite failures remain unresolved; this follow-up does not claim a full-suite pass.
