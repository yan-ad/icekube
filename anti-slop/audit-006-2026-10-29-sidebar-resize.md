# Workspace sidebar resizing review

Date: 2026-10-29. Mode: review after implementation. Direction: make the existing workspace sidebar resizable, preserving the Astryx shell, fixed icon-only Catalog rail and full-width narrow-window drawer.

## Findings awaiting approval

1. LOW, discoverability: the Astryx grip appears on hover or focus rather than remaining visible. This preserves the current quiet navigation edge, but first-time pointer users may not immediately discover resizing. An always-visible grip is an optional follow-up; it has not been added.
2. LOW, saved-width behavior: shrinking the desktop viewport clamps and saves the width. Enlarging the window does not restore the former wider selection automatically. This follows the installed Astryx hook's persistence behavior and is documented in DESIGN.md; a separate preferred-versus-effective width model is an optional follow-up.

## Feature evidence

- Pointer resizing reflows the workspace immediately, without a width transition while dragging. The Catalog rail stays unchanged.
- The focusable, named separator controls the workspace navigation pane and exposes live minimum, maximum and current width. Tab reaches it from navigation; Left/Right, Home and End resize within bounds.
- The minimum is 176 CSS pixels; the maximum is the smaller of 35% of the viewport or 480 CSS pixels. The existing desktop initial proportion is retained, capped at 256 CSS pixels.
- The width is shared across cluster routes and restored after returning from Catalog or reloading. Only this non-sensitive UI setting uses localStorage; no domain records or credentials are moved into renderer storage.
- Tests cover malformed and out-of-range saved values, disabled storage, pointer cancellation, view disposal during dragging, enlarged text, a fullscreen-sized viewport, reduced motion, and desktop-to-drawer transitions.
- Light and dark themes are explicitly asserted. Focus-outline contrast against the application body background is computed and meets 3:1 in both tested themes. No palette, typography, native control budget or CSP change was introduced.
- The narrow drawer has no resize control. Existing disclosure, leaf navigation, pin actions, dismissal and focus-return behavior are preserved.
- Uses the installed Astryx 0.7.3 useResizable/ResizeHandle APIs; no custom pointer owner or new dependency. This implements the user's Iceon request, not a newly verified Freelens workflow.

## Validation

- `bun run build`: passed; the existing large-bundle warning remains.
- Final production-bundle integration run: 48 passed across sidebar resize, sidebar motion, cluster navigation, section pins and window layout (33.6 seconds).
- Expanded dedicated resize run: 11 passed, including explicit themes, focus contrast, console-error rejection and disposal/enlarged-text checks; these expanded cases also passed in the final combined run.
- `git diff --check`: passed.

The initial development-server run failed to render the application while reusing an already-running inspection server; retained trace output also collided with concurrent test activity. The successful runs used the isolated production preview and feature-specific output directories. An initial production run exposed an overly strict test assertion that ignored the existing one-pixel shell divider; correcting that assertion required no runtime workaround.

All browser tests use synthetic metadata and mocked IPC. Fullscreen-sized browser layout and mocked native window tests do not prove actual OS fullscreen, drag or webview behavior. Native macOS/Windows/Linux smoke tests were not performed. No real kubeconfig, credential, cluster or Rust backend test was needed for this presentation-only change. No optional post-review visual changes were applied.
