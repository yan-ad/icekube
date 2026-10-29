# 17. Post-implementation pane UI audit

Date: 2026-10-29. Requested mode: antislop AFTER implementation. Audit only; no production UI or theme changes were made. This file is the task-scoped audit record rather than an additional `anti-slop/` artifact.

## Scope and direction

Read `DESIGN.md`, the antislop core, UI and human skills, ResourceInspector, ResourceMetadata, ResourceEventDiagnostic, HelmDetails, DetailCollections, WorkloadActions, ResourceEditor, ServiceForwardActions, NodeActions, ResourcePaneDelete and the pane-integration/delete fixtures. Direction remains ENERGY 1 / RHYTHM 1 / MOTION 1. Compact rows, plain metadata and predictable section placement serve operational scanning. Existing theme tokens serve mode consistency; no new palette, decoration, graphics or layout framework is warranted.

Only `tests/pane-accessibility.spec.ts` and this report belong to this audit. No new div/span markup, raw CSS import, image asset or production dependency was introduced. The test's explicit root font-size assignment is an accessibility probe, not production styling.

## Numbered findings, not silently fixed

1. **HIGH: Delete confirmation loses keyboard focus on dismissal (R-32, C-4).** Open deployment details, focus `Delete resource`, press Enter, then Escape. The dialog closes and the trigger re-enables but focus does not return to it. Reproduced at 390, 800 and 1440 in both themes. `ResourcePaneDelete` disables its trigger while `target !== null`; automatic dialog trigger capture is therefore an owner to investigate, not a proven root cause. The dedicated regression test is explicitly `test.fail`, retaining a failing expectation rather than labeling this behavior correct. Suggested fix for approval: keep an explicit trigger ref and restore focus after the confirmation is closed/re-enabled, including Cancel, Escape and successful Close paths. Do not change mutation authorization or permit duplicate submissions.

2. **HIGH: 390-wide pane at 200% text resize clips operational labels despite no document overflow (R-03, R-35, C-4).** Set root `font-size: 200%` with the inspector open at its default split. The screenshot shows Scale, Restart, Edit YAML and Delete resource reduced to ellipses, `Ready` reduced to `Rea...`, and the Namespace metadata label clipped at the pane edge. Close remains visible and keyboard-operable, but that is insufficient to claim complete text-resize resilience. Repro artifact: `/tmp/iceon-pane-audit-artifacts/pane-accessibility-pane-re-e21c1-easured-labels-at-390-light/pane-text-resize.png`. Suggested fix for approval: switch the narrow inspector to a full working-width surface or otherwise reflow labels/actions at enlarged text; preserve internal scrolling and the single toolbar. The automated no-overflow checks pass because clipping is contained, not because all text is readable.

3. **HIGH against antislop touch criterion: measured Close target is 28 by 28 CSS pixels, not 44 by 44 (R-03).** Measured before text resize at all three widths in both modes. At 390 its rectangle was x=354, y=53, width=28, height=28. This is the intentional `sm` desktop density, not evidence of a theme regression. It still fails this skill's 44px touch target criterion. Suggested fix for approval: enlarge hit areas in the touch/narrow interaction mode without a wholesale theme or density refactor. No claim is made that every control was measured or that this alone constitutes a complete WCAG target-spacing assessment.

## Executed checks

Fixture is a copy of the existing full-app pane-integration setup with synthetic cluster metadata, all permission checks mocked allowed and synthetic resources. It contains 1,200 annotation characters split into two 600-character values. The parser limits each metadata value to 1,024 bytes; sending a single 1,200-character value would test contract rejection rather than long-metadata layout. No credentials, real kubeconfigs, native APIs, cluster writes or live network connections were used. Scale and Delete dialogs were opened and cancelled; no mutation commands were sent.

| Interaction/check | Observed result |
| --- | --- |
| Deployment row opens details | Pass at 390, 800, 1440, light and dark |
| Long metadata and related tables | Internal body scroll exists; document stays within viewport |
| Show managed fields with Enter | `aria-expanded=false` becomes true; manager/fields appear |
| Hide managed fields with Space | `aria-expanded=false` restored, including enlarged text |
| Reduced motion | Inspector computed transition-duration is 0s |
| Scale confirmation | Clear cluster, namespace, kind/name, UID and version text |
| Invalid replicas | Explicit error text and disabled Confirm action, not color-only |
| Escape from Scale dialog | Closes and restores focus to Scale |
| Delete confirmation | Named target region identifies Fixture cluster; list says team-a/sample-a; Delete 1 resource enabled |
| Escape from Delete dialog | Closes, sends no delete; focus restoration defect retained |
| Close inspector with keyboard Enter | Closes and restores original deployment-row trigger while connected |
| Related event Message with Enter | Navigates to exact event detail and displays diagnostic privacy warning |
| Close after related navigation | Named Close button works; original row can be unmounted by navigation, so no stale-trigger restoration claim |
| 200% root text resize | No document overflow; Close remains visible before and after body scroll; narrow-label clipping remains a finding |
| Browser console in six matrix cases | No console errors observed; pageerror listener rejects runtime errors |

A related-navigation Escape attempt initially failed once while route/selection updates were still settling. The final related-message test uses the named Close button, so this audit does not claim settled Escape reliability for that transition. Scale dialog Escape and Delete dialog Escape are tested separately.

## Computed text contrast, limited to two new plain-text roles

Calculated from actual computed foreground colors and nearest opaque ancestor background, using WCAG sRGB linearization and luminance. Translucent text/background would reject the helper rather than receive an invented ratio. Each sample was checked at every width. Measurements are written beside screenshots in `/tmp/iceon-pane-audit-artifacts/*/measurements.json`.

| Sample | Light | Dark |
| --- | --- | --- |
| Some metadata is unavailable or redacted. | rgb(71,71,71) on rgb(255,255,255), **9.29:1** | rgb(158,158,158) on rgb(38,38,38), **5.65:1** |
| Pods Status (returned subset, complete): Running: 1 | rgb(0,0,0) on rgb(255,255,255), **21.00:1** | rgb(255,255,255) on rgb(38,38,38), **15.13:1** |

Both sampled normal-text roles exceed 4.5:1. This is not an audit or assertion of the entire Astryx palette, semantic badges, disabled controls, selected rows or focus-ring contrast. Those remain unmeasured here.

## Exact validation and delivery gate

- Isolated Vite served `127.0.0.1:1495` using `/tmp/iceon-pane-vite.config.mjs`, HMR disabled and file watching disabled. No production source was changed to configure the server.
- `bunx playwright test --config /tmp/iceon-pane-playwright.config.mjs`: **7 ordinary passes and 1 expected failure**. Playwright summarizes this as “8 passed”; that summary must not be represented as eight working accessibility scenarios. One worker, artifacts under `/tmp/iceon-pane-audit-artifacts`.
- `bun run build`: passed TypeScript and production build; existing large-chunk warning remains.
- Screenshots at enlarged text inspected at 390 light and 1440 dark. Other matrix screenshots captured, not all visually reviewed.
- Delivery gate **not fully passed** because findings 1–3 remain. Keyboard activation, scoped plain-label contrast, reduced motion, internal scrolling and explicit confirmation text have evidence. No unsupported global accessibility, complete feature-parity or native OS claim is made.

Helm, Node, Service forwarding and YAML editor were read for this targeted audit but not individually clicked in the new test. Their component-specific integration/lifecycle tests and native checks remain separate. Real browser zoom, WebKit/native webview behavior, mobile on-screen keyboard, full Tab-order traversal, screen-reader output and 3:1 focus-indicator contrast were not verified. The root 200% text-resize probe is **not browser zoom** and does not substitute for it.
