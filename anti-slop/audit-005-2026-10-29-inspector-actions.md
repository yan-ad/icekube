# Right-side inspector actions and detail density audit

Date: 2026-10-29. Mode: audit first; UI changes require approval by finding number.

## Scope and direction

Reviewed the shared right-side resource inspector and its generic-resource, Pod, related-resource, Helm and captured-summary render paths. The supplied screenshots show the existing problem: text action launchers separated from the fixed header, and long single-column facts and labels.

Keep Astryx neutral surfaces, theme typography, Tabler icons and token spacing. ENERGY 1 / RHYTHM 1 / MOTION 1, as specified in `DESIGN.md:89–107`. Put operational launchers in the fixed inspector header so they remain reachable while content scrolls; use two columns for short facts and key/value entries to reduce vertical travel without narrowing YAML or tables. No new visual assets, backend operations, dependencies, or security permissions are proposed. This is an Iceon-requested refinement, not a new upstream workflow or a claim of Freelens parity.

## Findings awaiting approval

### 1. MEDIUM: resource action launchers remain text buttons in the scrolling body

Rules: R-31 (placement needs a purpose), C-3 (content-driven composition); the icon-only/header requirement comes directly from this request, not an assertion that text buttons are inherently inaccessible.

The header already provides named, tooltip-equipped Pod Logs, Shell, Attach and Port forward, plus Refresh, Expand/Restore and Close (`src/app/cluster/ResourceInspector.tsx:185–194`). Other launchers are inserted below status and above facts, or below the entire Pod YAML block:

| Drawer | Body launchers | Source |
| --- | --- | --- |
| Pod | Edit YAML, Delete, Force delete, conditional Finalize | `src/app/cluster/PodDetailsView.tsx:115–124` |
| Supported generic resources | Edit YAML | `src/app/cluster/ResourceEditor.tsx:66` |
| Generic resources | Delete resource | `src/app/cluster/ResourcePaneDelete.tsx:47–52` |
| Deployment, StatefulSet | Scale, Restart | `src/app/cluster/WorkloadActions.tsx:17–26,92–95` |
| ReplicaSet, ReplicationController | Scale | same source |
| DaemonSet | Restart | same source |
| Job | Suspend or Resume, when suspension state is known | same source |
| CronJob | Suspend or Resume, plus Trigger | same source |
| Node | Cordon or Uncordon; Scheduling unavailable when unknown | `src/app/cluster/NodeActions.tsx:68–70` |
| Service | One Forward port launcher per reviewed TCP port | `src/app/cluster/ServiceForwardActions.tsx:68–69` |

Proposed fix: move these launchers into the inspector header as IconButtons with explicit accessible names and hover/focus tooltips. Use concrete edit/trash/scale/restart/pause/play/lock/plug glyphs; distinguish Restart workload from Refresh details. Keep Force delete and Remove finalizers visibly distinguishable from ordinary Delete, with their existing warnings and confirmation step. Do not invent operations for unsupported kinds. Generic YAML editing currently allows 14 reviewed kinds, not every resource (`src/app/cluster/resourceEditApi.ts:9–10`).

Acceptance: no duplicate body launchers; every visible header icon has a meaningful accessible name and tooltip; exact existing target UID/resourceVersion, permission gates, dry-run, cancellation and confirmation behavior remain intact; confirmation dismissal returns focus to the relocated trigger. No mutation occurs merely from opening a launcher.

### 2. LOW: all fact and metadata groups use one column, including wide inspectors

Rules: R-31 and C-3; the exact two-column requirement comes from this request.

Astryx's installed MetadataList documentation reports `columns='single'` as the default and supports `columns={2}`. Source evidence:

- Generic Name, Created, UID, Resource version and kind-specific facts: `src/app/cluster/ResourceInspector.tsx:253–262`; additional fact sections: `266–268`.
- Labels, annotations, finalizers and managed fields: `src/app/cluster/ResourceMetadata.tsx:8–28`.
- Pod facts explicitly force `columns='single'`: `src/app/cluster/PodDetailsView.tsx:50–69`. Conditions, container facts and event facts also force single-column lists: `74–78,86–96,107–112`.
- Helm identity and release-history facts use the default: `src/app/cluster/HelmDetails.tsx:43–59`.
- Captured summaries, including custom instances, use the default: `src/app/cluster/ResourceInspector.tsx:197–200`.

Proposed fix: a shared responsive detail-list presentation with at most two columns, based on actual available inspector width rather than window width. Use two columns for identity/facts and ordinary label/annotation entries; collapse to one when resized narrow or text is enlarged. Preserve row-major reading order and wrap long keys, UIDs, names and values. Keep YAML, diagnostic messages, managed-field JSON and related-resource tables full-width when needed; do not halve their reading space just to force a grid. Use component props first, not a broad selector overriding every MetadataList.

Acceptance: verify generic/Node, Pod, Helm and summary layouts at normal and expanded widths, dragged minimum width, narrow windows and 200% text; both themes; no clipped values or horizontal page overflow. Record geometry proving two columns when there is room and one when there is not. No numeric scroll-reduction claim until measured.

### 3. HIGH: moving all launchers into the current wrapping header needs an overflow design

Rules: R-03/R-32/C-4 (responsive and keyboard resilience). This is an implementation risk requiring a coordinated fix with finding 1, not a proven current overflow defect.

`src/app/cluster/ResourceInspector.tsx:187` wraps the header actions beside a truncating title. A normal Pod already has seven header icons, before adding Edit, Delete, Force delete and conditional Finalize. Services can add one launcher per TCP port. The inspector can be resized very narrow (`102–107,157–166`) and retains inset rather than full-window space. Current CSS sets coarse-pointer header targets to spacing-11 (`src/app/cluster/resource-inspector.css:68–73`).

Proposed fix: retain one fixed header with icon-only launchers; use a tooltip-equipped More actions icon for lower-frequency/destructive operations at constrained widths, with readable named menu items. Keep Refresh, Expand/Restore and Close reachable, and keep the resource title discoverable. Prefer one Service forward icon opening port selection over an unbounded series of indistinguishable plug icons. Menu items are text choices, not standalone body buttons. Do not shrink touch targets to fit.

Acceptance: largest Pod and workload action sets, many-port Service, long name, narrow/dragged/expanded widths, coarse pointer, 200% text and both themes. Exercise menu keyboard opening, item activation, Escape and focus return; ensure controls do not overlap the resize handle or disappear outside the panel. This finding is a dependency of finding 1.

### 4. MEDIUM: recovery and disclosure controls need an explicit compact policy; Helm advertises an unsupported local shortcut

Rules: R-26/R-32/R-31; keep action scope clear.

- Related collections render body text Retry controls (`src/app/cluster/DetailCollections.tsx:44–51`). Each retries a specific collection, not the entire inspector. Proposed: a named retry icon beside that collection's heading, retaining failure/stale text and local retry behavior.
- Show/Hide managed fields is a contextual text disclosure with `aria-expanded` (`src/app/cluster/ResourceMetadata.tsx:19–28`). Proposed: a labeled metadata section with an icon-only disclosure and state-specific tooltip; preserve keyboard operation and connect it to its controlled region. Keep it beside its content, not in the global inspector toolbar.
- Helm errors render another body Refresh through ContentError (`src/app/cluster/HelmDetails.tsx:40`; `src/app/components/ContentError.tsx:18–22`), in addition to header Refresh. The header advertises Cmd/Ctrl+R for Helm, but the shortcut listener only runs for resource selections (`src/app/cluster/ResourceInspector.tsx:145–156,191`). Proposed: consolidate retry through the header and make the advertised focused Helm shortcut actually refresh Helm details, not the background view; preserve error and retained-stale notices.

Acceptance: collection retry only reloads its collection; disclosure exposes and hides the correct fields with announced state; failed Helm detail loads recover through the header; Cmd/Ctrl+R refreshes the focused Helm inspector only, with duplicate/repeated reads blocked.

### 5. HIGH: retained stale Pod details do not disable body mutation/edit launchers

Rules: R-27/C-4 (honest stale/loading/error states). This is a presentation guard inconsistency observed in source, not evidence of a backend authorization bypass.

Generic-resource action launchers disappear during detail loading/error and Delete disables (`src/app/cluster/ResourceInspector.tsx:248–252`). Pods retain details on refresh failure, but `AuthorizedPodTab` passes no loading/error/busy state to PodDetailsView (`src/app/cluster/PodDock.tsx:148–165`). Its launchers only check permission decisions (`src/app/cluster/PodDetailsView.tsx:119–122`). The mutation handler checks details, confirmation, busy and permission, but not a failed-refresh freshness flag (`src/app/cluster/PodDock.tsx:153–157`). Existing header Pod operational actions likewise disable for loading/identity/permission, not a failed detail refresh (`src/app/cluster/ResourceInspector.tsx:160–162,188–190`).

Proposed fix: publish the current Pod detail state to the toolbar and disable edit/mutation launchers while loading, stale after failure, or submitting. Keep Refresh available to recover and preserve existing UID/resourceVersion checks and confirmation warnings. Review failure/retry handling so an uncertain submitted write requires a new baseline rather than an automatic replay. Decide operational Logs/Shell/Attach/Forward freshness policy explicitly; do not accidentally change it as a side effect of moving mutation launchers.

Acceptance: hold/fail Pod refresh and inspect enabled states; no Pod mutation on stale baseline through the relocated toolbar; fresh successful read restores appropriate actions; permission loss, replaced UID, operation failure and close/reopen cannot reuse a previous target. Use mocked IPC only.

## Controls that should retain text and context

The request is interpreted as compact operational launchers, not removing meaningful labels from data or safety decisions:

- Resource-name, namespace, Node, ServiceAccount and event-message navigation remain text links/buttons because their text is the resource being inspected (`ResourceInspector.tsx:94–96,253–260`; `PodDetailsView.tsx:50–65`; `DetailCollections.tsx:26–34`).
- Form submissions and confirmation choices retain explicit text: Save YAML, Server dry-run, Confirm apply/mutation/action, Delete confirmation, Cancel/Stop, Reload baseline and Start forward. They belong to the form/dialog, not the inspector's top toolbar.
- Conditions/status are data, not toolbar actions. Keep actual loading, empty, permission, stale, partial, listener-result and error messages visible.
- Helm exposes no drawer install/rollback/uninstall action; captured custom-instance/summary drawers expose no live refresh or mutations. Do not add unavailable behavior for visual consistency.

## Implementation boundaries

Use one selection-scoped toolbar action surface so child workflows retain state, identity checks and dialogs without duplicating buttons or registering stale callbacks. Clear actions on selection/session change and disposal. Preserve in-progress workflow cancellation and never describe cancellation as undoing a dispatched write. Do not lift cluster operations or credentials into the renderer; this refinement changes presentation and existing typed IPC wiring only.

Read-only audit found no literal HTML `<button>` problem: these controls use Astryx Button components. The requested change is text-label presentation and placement, not replacing raw HTML elements.

## Validation

- `bun run build`: PASS. Existing JavaScript chunk-size warning remains; no new dependencies or source changes.
- `bunx astryx component MetadataList`: verified installed component default and supported column prop.
- Focused development Playwright baseline: 22 passed, 6 failed (41.6s). All six failures occurred at the final console-error assertion in the light/dark, 390/800/1440 accessibility cases, reporting `net::ERR_CONNECTION_REFUSED`; preceding layout, keyboard, confirmation and contrast assertions completed. Optional React DevTools injection exists in `vite.config.ts:15–26`, but the failed request's URL could not be recovered because its trace was no longer present, so that attribution remains unconfirmed.
- Isolated production-preview baseline: all 28 passed (16.9s). Command: `ICEON_TEST_PRODUCTION=1 bun run test:e2e tests/compact-inspector.spec.ts tests/pane-accessibility.spec.ts tests/inspector-resize.spec.ts tests/helm-details.spec.ts --workers=1 --output=artifacts/inspector-audit-baseline`. This preview runs on port 1422 without development script injection; no existing development server was stopped or changed.
- Recorded click-through coverage: Pod Refresh retains content after a failed read; Edit then Save opens UID/version confirmation; Escape dismisses confirmation without mutation; explicit Confirm sends the mocked mutation; Logs/Shell/Attach/Forward each open the correct UID-scoped dock; keyboard refresh only rereads the focused resource; resize/Expand/Restore/Close and disposal work; Helm chart/release details and cancellation remain scoped; metadata disclosure opens/closes by keyboard; Scale validates invalid replicas without dispatch; Delete opens its confirmation and returns focus on Escape; related Event navigation resolves and returns focus. Light/dark, narrow widths, coarse-pointer Close target, reduced motion and 200% text checks passed in this production fixture baseline. These are synthetic IPC observations, not live operations.
- Existing tests explicitly expect Edit YAML at the bottom of the Pod drawer (`tests/compact-inspector.spec.ts:51–75,101–114`); approved implementation must update these expectations, not merely preserve a passing old layout.
- Current baseline tests are not evidence that the proposed icon-toolbar or two-column changes are implemented. No live cluster, real kubeconfig, native OS interaction or Rust behavior was tested during this audit. No UI files were changed.
