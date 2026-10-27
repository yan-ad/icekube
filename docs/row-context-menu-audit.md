# Row context-menu audit

## Automated boundary

`tests/row-context-menu.spec.ts` exercises the application through real Chromium
right-click and Shift+F10 events. The fixture supplies only synthetic catalog,
session, inventory, details and mutation responses. Native menus are represented
by Tauri `transformCallback` registrations and scoped
`iceon://row-context-menu` emissions, not DOM menu items. Window layout remains
`platform: browser`; no native chrome or actual OS menu is launched.

Coverage includes all 41 Kubernetes inventory kinds, Helm charts/releases, and
running/stopped/error port forwards. Assertions cover exact row targets independent
of checkbox selection, deletion confirmation before IPC, chart-prefilled dry-run
and explicit install confirmation, forward stop/remove IDs, unsupported actions,
wrong cluster/session/request IDs, unknown event fields, replacement menu ownership,
dismissal, expired/retired callbacks, stale/replaced/filter/route/session changes,
asynchronous listen/show completion after unmount, popup errors, and the 30-second
listener deadline. Existing pure adapter tests remain separate.

## Ownership review

`RowContextMenu.tsx` clones the row and action list at opening. Its fingerprint
includes cluster, session, scope, rows and available actions. A layout-effect
cleanup aborts outstanding native work on fingerprint change or unmount; callbacks
also compare the fingerprint before calling the captured row handler.

`nativeContextMenu.ts` registers before showing, permits one active request,
checks the closed event shape plus cluster/session/request identity, and disposes
before dispatching an action. Abort during registration releases the eventual
listener. Abort during show cancels again after completion. Both the adapter and
Rust expire ownership at 30 seconds because Tauri has no portable dismiss event.

The backend previously allowed `edit` for every Kubernetes kind even though only
Pod YAML editing is implemented. `allowed()` now limits Edit to Pods, alongside
the other Pod-only operations. Generic resources permit Details/Delete; charts
permit Details/Install; releases permit only Details; forwards permit
Details/Stop/Remove. Rust unit tests assert the complete action matrix.

## Separate follow-up for the confirmation owner

The integration audit observed that a successful context-row deletion can reopen
a fresh confirmation after inventory refresh instead of retaining its result.
`ResourceActions` keys `ResourceDelete` by `contextTarget`; refresh changes
availability, invalidates `useResourceRowMenu`'s deletion identity, and remounts the
confirmation owner. `ResourceDelete` can also retain its own `targets` after its
`contextTarget` becomes null. These files are outside this audit's edit ownership.
The new tests assert confirmation-before-mutation and the exact single deletion
request, not a misleading success-result assertion. The confirmation lifecycle
should be fixed and regression-tested by its owner.

No native popup, OS dismissal/placement, real cluster, kubeconfig, auth helper,
Helm subprocess, or port-forward process behavior is claimed by these mocks.
