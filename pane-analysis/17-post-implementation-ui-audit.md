# 17. Post-implementation pane UI audit

Date: 2026-10-29. Requested mode: antislop AFTER implementation. Audit only; no production UI or theme changes were made. This file is the task-scoped audit record rather than an additional `anti-slop/` artifact.

## Scope and direction

Read `DESIGN.md`, the antislop core, UI and human skills, ResourceInspector, ResourceMetadata, ResourceEventDiagnostic, HelmDetails, DetailCollections, WorkloadActions, ResourceEditor, ServiceForwardActions, NodeActions, ResourcePaneDelete and the pane-integration/delete fixtures. Direction remains ENERGY 1 / RHYTHM 1 / MOTION 1. Compact rows, plain metadata and predictable section placement serve operational scanning. Existing theme tokens serve mode consistency; no new palette, decoration, graphics or layout framework is warranted.

Only `tests/pane-accessibility.spec.ts` and this report belong to this audit. No new div/span markup, raw CSS import, image asset or production dependency was introduced. The test's explicit root font-size assignment is an accessibility probe, not production styling.

## Numbered findings, not silently fixed

1. **Resolved for measured Escape path: Delete confirmation focus return (R-32, C-4).** Initially reproduced focus loss at all three widths in both themes and recorded an expected-failure regression. That is history, not the current result: the expected-failure marker was removed, `ResourcePaneDelete` now retains an explicit trigger ref and restores focus in a requestAnimationFrame after re-enabling it. All six matrix cases and the dedicated regression pass `toBeFocused()` after Escape. Cancel and successful post-delete Close were not exercised in this audit; no success-path focus claim is made.

2. **Partially resolved, HIGH residual: enlarged raw status still truncates at 390 (R-03, R-35, C-4).** Originally Scale, Restart, Edit YAML, Delete resource, Ready and Namespace clipped at 200% root text resize. Current leaf-element measurements prove the four operational labels fit and Namespace wraps. The rule in `src/app/cluster/resource-inspector.css:47-52` targets button descendant spans only. The raw `Ready` status remains `white-space: nowrap; text-overflow: ellipsis; overflow: hidden`: leaf scrollWidth **67** vs clientWidth **62**, text right **347.15625** vs leaf right **342** at 390 in both themes. Selector: Resource details region, `getByText("Ready", { exact: true }).first()`. No document overflow does not clear this finding. Operational words now wrap into very short fragments within a 45.75px-wide label (Scale two lines, Restart three, Edit YAML four, Delete resource five); measured containment is not a claim of ideal legibility or complete enlarged-pane resilience.

3. **Resolved for measured coarse-pointer Close: 44 by 44 CSS pixels (R-03).** A separate Chromium context uses viewport 390x800 and `hasTouch: true`; `matchMedia("(pointer: coarse)").matches` is asserted true. Actual Close bounding width and height are each 44, and tapping it closes the pane. `page.emulateMedia` is used only for reduced motion, not to pretend to set pointer capability. Fine-pointer desktop density remains 28 by 28 (at 390, x=354/y=53), intentionally outside this touch-specific assertion. Not every control or target-spacing condition was measured.

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
| Escape from Delete dialog | Closes, sends no delete; focus returns to re-enabled Delete resource trigger in all six cases |
| Close inspector with keyboard Enter | Closes and restores original deployment-row trigger while connected |
| Related event Message with Enter | Navigates to exact event detail and displays diagnostic privacy warning |
| Close after related navigation | Named Close button works; original row can be unmounted by navigation, so no stale-trigger restoration claim |
| 200% root text resize | No document overflow; operational text/Namespace bounds pass; internal body scrollTop becomes positive; Close stays visible; raw Ready clipping remains |
| Browser console in six matrix cases | No console errors observed; pageerror listener rejects runtime errors |

A related-navigation Escape attempt initially failed once while route/selection updates were still settling. The final related-message test uses the named Close button, so this audit does not claim settled Escape reliability for that transition. Scale dialog Escape and Delete dialog Escape are tested separately.

## Computed text contrast, limited to two new plain-text roles

Calculated from actual computed foreground colors and nearest opaque ancestor background, using WCAG sRGB linearization and luminance. Translucent text/background would reject the helper rather than receive an invented ratio. Each sample was checked at every width. Measurements are written beside screenshots in `/tmp/iceon-pane-audit-artifacts/*/measurements.json`.

| Sample | Light | Dark |
| --- | --- | --- |
| Some metadata is unavailable or redacted. | rgb(71,71,71) on rgb(255,255,255), **9.29:1** | rgb(158,158,158) on rgb(38,38,38), **5.65:1** |
| Pods Status (returned subset, complete): Running: 1 | rgb(0,0,0) on rgb(255,255,255), **21.00:1** | rgb(255,255,255) on rgb(38,38,38), **15.13:1** |

Both sampled normal-text roles exceed 4.5:1. This is not an audit or assertion of the entire Astryx palette, semantic badges, disabled controls, selected rows or focus-ring contrast. Those remain unmeasured here.

## Enlarged operational-text measurements

Root font computes to **32px** after assigning `200%`; viewport remains 390x800 CSS pixels. Both themes produce the same geometry. For each button the helper locates the leaf text element, records scrollWidth/clientWidth and leaf/control DOMRects, and bounds its actual text with a DOM Range. Assertions check horizontal containment, text bottom within the button, and button right within the viewport. These buttons can sit below the viewport until the internal body is scrolled; containment does not require showing the entire long pane at once.

| Exact button name | Leaf scrollWidth/clientWidth | Leaf width/height | Actual text width/height | Button width/height |
| --- | --- | --- | --- | --- |
| Scale | 46/46 | 45.75/80 | 36.4375/73 | 93.75/112 |
| Restart | 46/46 | 45.75/120 | 37.84375/113 | 93.75/152 |
| Edit YAML | 46/46 | 45.75/160 | 39.1875/153 | 93.75/192 |
| Delete resource | 46/46 | 45.75/200 | 41.171875/193 | 93.75/232 |

Namespace: scrollWidth/clientWidth **94/94**, leaf **93.75x80**, text **87.015625x73**, contained. Ready: **67/62**, still ellipsized, recorded diagnostically rather than disguised as a passing status-readability test. The operational-label regression would fail if those buttons reverted to ellipsized overflow. Full numeric positions, computed overflow styles, contrast samples and touch rectangle are retained in each test's `measurements.json` and attached JSON. No real mutation was submitted.

## Exact validation and delivery gate

- Isolated Vite served `127.0.0.1:1495` using `/tmp/iceon-pane-vite.config.mjs`, HMR disabled and file watching disabled. No production source was changed to configure the server.
- `bunx playwright test --config /tmp/iceon-pane-playwright.config.mjs`: **9 ordinary passes, no expected failures** in the recheck. One worker, artifacts under `/tmp/iceon-pane-audit-artifacts`. Historical first audit: 7 ordinary passes and 1 expected failure (Playwright displayed “8 passed”); this has been superseded, not erased.
- Prior `bun run build` passed TypeScript and production build with the existing large-chunk warning. The current recheck changes test/report files only and does not claim a new production build run.
- Enlarged text screenshots are captured as supplementary artifacts, not browser zoom evidence. Current conclusions use DOM measurements, not screenshot-only inference.
- Delivery gate **not fully passed**: finding 2 retains measured raw-status truncation. Findings 1 and 3 are resolved only for the measured paths. Keyboard activation, scoped plain-label contrast, reduced motion, internal scrolling and explicit confirmation text have evidence. No unsupported global accessibility, complete feature-parity or native OS claim is made.

Helm, Node, Service forwarding and YAML editor were read for this targeted audit but not individually clicked in the new test. Their component-specific integration/lifecycle tests and native checks remain separate. Real browser zoom, WebKit/native webview behavior, mobile on-screen keyboard, full Tab-order traversal, screen-reader output and 3:1 focus-indicator contrast were not verified. The root 200% text-resize probe is **not browser zoom** and does not substitute for it.
