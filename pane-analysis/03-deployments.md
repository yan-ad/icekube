# Workloads / Deployments : source audit

Coordinating audit note: this chapter records the source-inspection pass. Executed fixture results, concurrent working-tree changes and unresolved validation failures are in [07: Validation](07-validation.md).

## Scope and evidence

- Iceon: `/Users/user1/Kerjaa/icekube`, HEAD `e71baf2d51d2be391485d52dd837f428dc8d21aa`.
- Behavioral reference: local `/Users/user1/Kerjaa/freelens`, HEAD `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, supplied version `v1.10.3-533-gcd07118f`. Both commit IDs were checked with `git rev-parse HEAD`.
- Audit date: 2026-10-29. **Static source inspection only.** No tests, app launches, credentials, Kubernetes traffic or mutations were performed. Test files named below are fixture leads, not passing results. No upstream source was changed or copied.
- Read `DESIGN.md`, particularly resource inspection/loading (lines 180–240), resource tables/namespace scope (514 onward), deletion (582 onward), and creation/Pod editing distinctions. Preserve Rust-owned networking/auth/domain operations and Astryx presentation; parity does not require Electron architecture.
- `docs/freelens-detail-parity.md` was a lead, not authority. Important correction: the pinned Deployment detail component does **not** render `PodDetailsStatuses` and does **not** render an Images field. Do not import either claim from another workload or from older notes.

Path abbreviations below: **I** = Iceon root; **F** = Freelens root; **FC** = `F/packages/core/src`; **RC** = `FC/renderer/components`; **KA** = `F/packages/utility-features/kube-api/src`; **KO** = `F/packages/kube-object/src`.

## Source map

| Surface | Rechecked source |
| --- | --- |
| Iceon list and action entry points | `I/src/app/cluster/{resourceViews.ts,ResourceTablePage.tsx,ResourceActions.tsx,RowContextMenu.tsx,ResourceSelection.tsx}` |
| Iceon pane and DTO | `I/src/app/cluster/{ResourceInspector.tsx,detailApi.ts}`; `I/src-tauri/src/connection/{resources.rs,detail_facts.rs,details.rs,transport.rs}` |
| Iceon mutation/RBAC boundary | `I/src/app/cluster/{ResourceCreate.tsx,ResourceDelete.tsx,createApi.ts,deleteApi.ts}`; `I/src-tauri/src/connection/{create.rs,delete.rs,permissions.rs}`; `I/src-tauri/src/lib.rs` detail command registration |
| Freelens table/model/store | `RC/workloads-deployments/{deployments.tsx,store.ts,store.injectable.ts}`; `KO/specifics/deployment.ts` |
| Freelens details/revisions/actions | `RC/workloads-deployments/{deployment-details.tsx,deployment-replicasets.tsx,deployment-menu.tsx,scale/dialog.tsx}`; `RC/workloads-replicasets/{store.ts,replica-set-menu.tsx}` |
| Shared composition | `RC/kube-object-list-layout/kube-object-list-layout.tsx`; `RC/item-object-list/content.tsx`; `FC/common/item.store.ts`; `RC/table/table.tsx`; `RC/kube-object-menu/{kube-object-menu.tsx,kube-object-delete-service.injectable.ts}`; `RC/kube-object-details/kube-object-details.tsx` |
| Shared detail sections | `RC/kube-object-meta/kube-object-meta.tsx`; `RC/kube-object-conditions/kube-object-conditions-drawer.tsx`; `RC/workloads-pods/{pod-details-list.tsx,pod-details-tolerations.tsx,pod-tolerations.tsx,pod-details-affinities.tsx,pod-details-statuses.tsx}`; `RC/events/{kube-event-details.tsx,store.ts}` |
| Request semantics | `KA/endpoints/{deployment.api.ts,replica-set.api.ts}`; `KA/kube-api.ts` (`getResourceScale`, `scaleResource`, `patch`, `delete`); `FC/common/k8s-api/kube-object.store.ts`; `RC/dock/edit-resource/edit-resource-model/{edit-resource-model.injectable.tsx,request-patch-kube-resource.injectable.ts}` |
| Optional metrics | `RC/workloads-deployments/metrics-details-component.tsx`; `RC/kube-object-details/kube-object-detail-items/metrics/{deployment-details-metrics.injectable.ts,get-metrics-kube-object-detail-item.injectable.tsx}`; `FC/features/metrics/metrics-feature.ts` |

## Table: exact field-by-field comparison

Freelens `deployments.tsx` declares configurable columns in this order. `Replicas` is hidden by default; selection/menu cells come from the shared list. Iceon's selection and Actions columns are also shared additions, not fields in `resourceViews.ts`.

| Freelens column | Value / sorting callback | Iceon at audited HEAD |
| --- | --- | --- |
| Name | `getName()`; name sort | Name button opens inspector. Rust inventory ordering, no header sort plugin. |
| Namespace | namespace badge changes scope; namespace sort | Namespace relationship button opens/navigates Namespace details, not the same scope-filter gesture. |
| Replicas (default hidden) | `availableReplicas || 0` / `replicas || 0`; sort `available * 1,000,000 + total` | Visible **Current** is only `/status/replicas`, not an available/total ratio. No configurable hidden ratio column. |
| Ready | `status.readyReplicas || 0`; numeric | Ready `/status/readyReplicas`. |
| Desired | `getReplicas()` = `spec.replicas || 0`; numeric | Desired `/spec/replicas`. |
| Updated | `status.updatedReplicas || 0`; numeric | Updated `/status/updatedReplicas`. |
| Available | `status.availableReplicas || 0`; numeric | Available `/status/availableReplicas`. |
| Age | `KubeObjectAge`; negative creation timestamp callback | Age from projected `createdAt`, no header sorting. |
| Conditions | condition badges/tooltips; search/sort active (`True`) condition type text | **Status** uses only the first `Available` condition's status (`True`/`False`/`Unknown`), not all conditions or reasons. |

Iceon order: `Name | Namespace | Current | Desired | Ready | Updated | Available | Age | Status`, plus checkbox and trailing Actions. Thus Ready/Desired order differs as well. Missing numeric projections display `N/A`, whereas upstream explicitly substitutes zero. This is an intentional honesty difference to preserve unless a field is known to default to zero.

Default ordering needs two layers: Freelens `DeploymentStore.sorting` is desired replica count **descending**. The list does not itself supply `sortByDefault`; Table can override with URL `sort`/`order` state and its model. Therefore do not call the table unconditionally name-sorted or unconditionally replica-sorted after user customization. Iceon transport sorts each returned bounded page by `(namespace, name)` ascending; it has no client header sorting or configurable column controls here. This is page-local ordering, not proof of global ordering across Kubernetes continuation pages.

### Table controls and scope

- Freelens uses `KubeObjectListLayout isConfigurable`, a namespace filter/shared search, table column customization, resize support in `item-object-list/content.tsx`, row checkboxes, selection removal and a generic create/add workflow. Search combines `getSearchFields()` (name, namespace, UID, labels) and active condition types.
- Iceon has namespace selection, debounced Search, Status selector, Clear filters, global toolbar Refresh/registered pagination actions, checkboxes, bottom-right Delete/Create. Search in Rust matches name, namespace, projected status and column values, **not metadata labels/UID or all condition types**. Filtering scans bounded pages; partial counts are not cluster totals.
- Ten-second first-page polling is distinct from watch. Deployment has no Pod-only Live sync control. Loading/refresh/pending search or stale/error inventory disables destructive scope-dependent actions. Namespace/filter/page/session changes reset selection and cancel obsolete reads.
- Freelens table declares an event-store dependency for status-related shared rendering. Iceon's first-Available condition scalar does not provide equivalent per-object warning/event diagnostics.

## Pane: fields, visibility and relationship semantics

`ResourceInspector.tsx` renders a generic metadata/details pane, not `DeploymentDetails`-equivalent content. It shows Status, Name, Namespace link, Created, UID, resource version, all projected inventory columns (controlledBy is currently projected only for Pods, not Deployments), then flat `sections`. Refresh/expand/restore/close are the only Deployment header actions. Pod-specific Logs/Shell/Attach/Port forward are not workload toolbar actions.

| Freelens pane content | Conditional rendering / semantics | Iceon comparison |
| --- | --- | --- |
| Shared metadata | Created age/date, deletion timestamp if present, name/namespace, labels, annotations, finalizers, owner links, managed-fields toggles. UID/resourceVersion/selfLink hidden by default. | Explicit UID/version shown; selected metadata only. Labels/annotations/finalizers/managed fields/deletion timestamp not equivalent. Do not expose arbitrary payloads merely for visual parity. |
| Replicas | Always desired, updated, total, available, unavailable; absent status numbers `?? 0` | Count facts present in Deployment and Deployment rollout sections, with absent values `Not reported`. Ready and observed generation also provided. |
| Selector | Nonempty `spec.selector.matchLabels`, badges | Bounded matchLabels facts plus expression key/operator. Expression **values are omitted**; this loses selector meaning for `In`/`NotIn`, without automatically making the response partial. |
| Node Selector | Only if template nodeSelector nonempty | Not projected. |
| Images | **No Deployment Images block in pinned component/model** | Not projected; not a proven Deployment pane gap against this pinned component. Template image editing could still be a future requirement. |
| Strategy Type | `spec.strategy.type` | Strategy plus extra max surge/max unavailable/paused/progress-deadline facts. Missing scalar facts remain `Not reported`; no structured rollout visualization. |
| Conditions | All conditions, hidden if none; disabled False badge and condition tooltip | Generic Conditions section has type/status/reason/last transition only. No condition message or badge/tooltip interaction. Maximum 12 rows and 32 facts can truncate; Coverage marker discloses limit/type omissions. |
| Tolerations | Hidden if empty; count toggle opens Key / Operator / Value / Effect / Seconds table | Absent. Upstream declares Value sortable but lacks its callback; do not reproduce this inconsistency. |
| Affinities | Hidden if no top-level affinity keys; count toggle, read-only YAML | Absent. Needs reviewed structured projection, not renderer raw workload objects. |
| Deploy Revisions | Spinner while no ReplicaSets and store not loaded; hide if loaded empty. Owner-UID matching; table Name / Namespace / Pods / Age / Actions, default Pods descending, no URL sort sync | Entire section absent. No revision list DTO, no ReplicaSet child request or pane-local actions. This is a ReplicaSet inventory, not a revision-number/timestamp rollback wizard. |
| Pods | See below | Entire workload child list absent. |
| Pod Status | **No `PodDetailsStatuses` invocation in DeploymentDetails** | Do not claim a missing Deployment phase-count chart. That component is used by DaemonSet/ReplicaSet/other panes. |
| Metrics | Separate registered metrics detail item, order -1, gated by metrics-details feature/provider; time-ranged PodCharts | No Deployment metrics pane. Presence in source/DI does not prove metrics data/provider exists at runtime. |
| Events | Shared KubeEventDetails always registered; subscribes event store, filters by involvedObject UID; newest lastTimestamp first, message, Source, Count, Sub-object, Last seen; explicit No events found | No object-specific event section/request. Separate Events destination exists and can link Event → involved resource; that is not workload → related events navigation. |

### Children are not interchangeable

- `DeploymentStore.getChildPods` finds Pods by **template labels and exact namespace**, not Deployment UID or selector expressions. A label-matching Pod can be listed even if not actually owned by a Deployment ReplicaSet. Label relation must be described honestly.
- `ReplicaSetStore.getReplicaSetsByOwner` matches any owner-ref UID to Deployment UID. Each revision's Pods count uses Pod ownership by ReplicaSet UID. Opening a revision row uses `showDetails(replica.selfLink, false)`; Name/Namespace links and a stopped-propagation KubeObjectMenu are separate interactive targets.
- Shared `PodDetailsList` waits for PodStore load, hides when loaded empty, virtualizes above 20. Workload columns: **Name | Node | Namespace | Ready | CPU | Memory | Status**. Ready is running-container count / container count. CPU defaults to three-decimal cores (zero simplified); memory uses byte units. Default CPU descending; name/node/namespace/CPU/memory sortable, Ready/Status not. Rows/links open Pod/Node/Namespace details. No inline Pod menu in this shared list.
- Its metrics interval is 120 seconds, immediate on mount, restarted when owner object changes and stopped on unmount. This is separate from Prometheus-style time-range PodCharts.
- Iceon has standalone Replica Sets and Pods tables, Pod inspector/dock and Pod runtime actions. Those capabilities are **present elsewhere but inaccessible through a Deployment child/revision section**. Do not report the Pod engine itself as absent.

## Interaction/action trace

| Entry point | Freelens | Iceon |
| --- | --- | --- |
| Ordinary row click | Shared list `onDetails` toggles drawer by selfLink; checkbox/menu cell stops propagation | Name button opens typed identity inspector. No whole-row click handler is installed by ResourceTablePage/row-menu plugin; checkbox is selection, not activation. |
| Row menu / context | Shared KubeObjectMenu supplies Scale, Restart, Edit, Delete; shared list explicitly opens that menu at cursor on right-click (`RC/kube-object-list-layout/kube-object-list-layout.tsx:205-235`) | Explicit Actions button, native context menu or browser fallback, right-click, ContextMenu/Shift+F10. Deployments get Details and Delete only. Review get/delete permissions on open, revalidate authorization/fingerprint before dispatch. |
| Pane toolbar | Same KubeObjectMenu with `toolbar=true`: workload items and generic Edit/Delete | Refresh, Expand/Restore, Close only; no Delete, Scale, Restart, Edit. Delete remains accessible from the table. |
| Scale dialog | GET replicas, current/desired values, slider and +/-; min 0; max 100 when current <=50, otherwise current*2. Warning current<10 and desired>90; Scale enabled after ready; unchanged value closes without PATCH; errors notify | No Deployment scale UI, IPC service or scale-specific permission contract. |
| Restart dialog | Confirmation naming deployment; Restart runs annotation patch; errors notify | Absent end-to-end. |
| Edit | Hides details, opens generic dock edit tab. Raw resource load → YAML draft → JSON diff → PATCH → success/error notification | Edit YAML is Pod-only in row-menu implementation. Generic creation YAML is not Deployment edit. |
| Delete | Confirmation cluster + namespace/name; generic delete or Force Finalize if terminating with finalizers; hides drawer before call | Table single-target and selected batch confirmation, UID/version protection, sequential per-target outcomes. No generic Force Finalize. |
| Create | Shared list/add infrastructure, not a specialized Deployment spec wizard in this component | Metadata-only apps/v1 Deployment scaffold. Choose explicit namespace, edit YAML, server dry-run, then confirm exact target. Not a deploy wizard or rollout action. |
| Rollback | **No Deployment rollback item/API in audited menu/model/API.** Revision menu offers ReplicaSet Scale and generic Edit/Delete, not rollback | No rollback. This is not established as a pinned-Freelens action gap. Helm release rollback source elsewhere must not be misattributed to Deployments. |

## HTTP, RBAC, identity, stale/cancel effects

### Freelens source semantics

- Apps/v1 namespaced Deployment list/detail use shared API/store reads/watch. `DeploymentApi.getReplicas` does **GET `/apis/apps/v1/namespaces/{ns}/deployments/{name}/scale`**, returns **status.replicas**, not spec.replicas. `scaleResource` issues **merge PATCH** to `/scale` body `{spec:{replicas:n}}`.
- Restart: **strategic merge PATCH** named Deployment, body `spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"] = ISO timestamp`. This is template rollout, not a process restart/delete-Pod command. Neither scale nor restart payload includes UID/resourceVersion preconditions.
- Generic Edit uses JSON PATCH diff (`createPatch(firstVersion,currentVersion)`) through `request-patch-kube-resource`; not PUT merely because shared KubeApi also has an `update()` PUT helper. The audited non-Pod diff path does not add a dedicated UID test/resourceVersion compare-and-swap. Do not infer safe replacement protection from having metadata in the initial YAML.
- Normal remove calls API delete by name/namespace; default Background propagation is a query parameter, with no DeleteOptions preconditions supplied by `store.remove`. Force Finalize merge-patches `metadata.finalizers=[]`; generic controller menu does not offer Pod-style force-delete. Selected removals use Promise.all.
- These menu items depend on store edit/remove capabilities and kind registrations, not Iceon's explicit verified operation checks. Server RBAC remains authoritative. Required operations differ: `/scale` get+patch; Deployment patch for restart/edit; delete for removal; child Pod/ReplicaSet/event list/watch and metrics have independent rights.
- Upstream lifecycle subscriptions/metrics timers dispose on unmount. The scale dialog's pending `onOpen` read does not show an Iceon-style monotonic identity/cancel contract. Dialog dismissal cannot be represented as rollback of an already submitted PATCH/DELETE.

### Iceon current semantics

- List GETs through Rust `transport.rs`, bounded 100 returned entries; bounded filtered scanning (10 pages / 1,000 items / five seconds) and continuation disclosure. Renderer performs no direct cluster HTTP.
- Named detail GET uses allowlisted apps/v1 path derived from kind/namespace/name, not a renderer URL. `details.rs` checks served kind/version, exact name/namespace, required valid UID and requested UID equality; replacement returns Conflict. `detailApi.ts` validates cluster/session/readId/reference/item identity and section limits before presentation.
- Detail lane cancels old reads, enforces monotonic readId and session lifetime. Frontend cleanup cancels exact request and ignores disposed promises; refresh failure retains same-object facts with stale warning; replacement selection remounts content. No automatic workload child fan-out occurs.
- Pane uses get PermissionGate and table list permission states. `details.rs` itself does not call `require_permissions`; request still faces server GET RBAC. Do not claim every read is reauthorized by the same preflight mechanism as writes.
- `delete.rs` requires verified **get + delete** for each named target, binds authorized client/epoch, GETs current object and compares **UID and resourceVersion**, then DELETEs with `DeleteOptions {propagationPolicy:"Background",preconditions:{uid,resourceVersion}}`. No force grace-period override or finalize patch. Accepted versus completed deletion is explicit.
- Frontend captures exact target(s), cluster/context and versions; sequential submissions, successful targets deselected, failures retained. Stop/Escape/disposal cancels active exact work and future submissions, not server effects. UI warns outcome may be uncertain and refresh is required; no automatic retry/rollback. Scope/inventory/menu authorization changes invalidate work.
- Creation: namespace/kind/name/YAML validation; server **POST `...?dryRun=All`**, then explicit-confirm POST normal collection. Rust requires create permission, rejects server-owned create identity fields such as UID/version. Dry-run and confirmation are separate calls, not atomic transaction/guaranteed later admission. Cancellation after POST is uncertain.
- `permissions.rs` includes generic Update/Patch, but only Pod subresource mappings (log/exec/attach/portforward); no Deployment scale permission/action mapping or controller restart/edit operation exists. Generic Patch enum alone is not an implemented scale/restart workflow.

## Prioritized gap ledger

Each owner below is a proposed Rust service location unless marked existing. These are acceptance proposals, not executed cases. All mutations require separate approval/spec work; do not bypass the Rust architecture to fill menus.

| Priority / gap | Rust owner and contract | Required UI states | Acceptance scenario |
| --- | --- | --- | --- |
| P1 : ReplicaSet revisions and correctly labeled related Pods | Extend `connection/details.rs` or dedicated `workload_relations.rs`: parent UID/session-scoped bounded relation DTO; distinguish UID ownership from label matches; independent Pod/ReplicaSet permissions and completeness | Loading, loaded-empty, partial, denied child source, stale retained children, replaced parent, disposed | Fixture with same labels on unrelated Pod, same-name replacement Deployment, owned/unowned ReplicaSets and >cap children: no ownership overclaim/cross-namespace leak; partial surfaced; selecting revision/Pod resolves exact UID; late reads ignored. |
| P1 : Node selector, tolerations, affinity, expression values | `connection/detail_facts.rs` / typed reviewed scheduling projection; no arbitrary raw YAML credential leakage; carry explicit coverage for unsupported structures | Absent vs not reported, expanded/collapsed, bounded/partial, malformed, stale | Fixture with matchExpressions `In [a,b]`, nested affinity, NoExecute toleration seconds and node selector: values preserved or partial disclosed, long/unsafe values bounded, empty blocks not invented. |
| P1 : Conditions/event diagnostics | `resources.rs` typed condition summary and `details.rs` object-UID event section; per-section get/list checks, bounded event messages | No events vs unavailable/denied, condition False/Unknown/True, partial, loading/stale | Multiple conditions including failed Progressing but Available=True; events on another same-name UID excluded; message/reason/timestamps readable; denial does not blank main facts. |
| P1 : Scale Deployment | New Rust controller mutation service plus `permissions.rs` explicit deployments/scale get+patch attributes; retain UID/version baseline, auth epoch and cancellation/outcome contract | Checking, denied/unknown, loading scale, draft incl zero, confirm, submitting, conflict, accepted/still progressing, uncertain | Fixture scale=3 →0; same-name UID replacement and version change must block; forbidden scale GET/PATCH separately shown; dismiss before send has no mutation, dismiss after send never says rolled back. |
| P1 : Restart Deployment | Same mutation service: reviewed timestamp template patch, exact scoped identity, patch right, server result validation | Confirm, submitting, denied/unknown, conflict, accepted/rollout pending, uncertain | Fixture asserts strategic patch path/body; cancel before confirm sends nothing; stale UID/auth epoch blocks; network interruption after submission requires refresh, no replay. |
| P1 : Generic controller YAML editing | Dedicated protected Rust edit baseline/dry-run/apply service; permission must match actual PATCH verb, not just Update; no renderer networking | Load, dirty draft, invalid YAML, preview, denied, conflict retaining draft, saving/uncertain | Edit Deployment image via fixture; immutable/invalid spec and 409 retain draft; replacement UID or changed session rejected; preview/create cannot be used as edit. |
| P2 : Sort/configuration and Conditions column | `resources.rs`/`transport.rs` own any bounded cross-page ordering/filter changes; frontend table owns visible-column/sort preference | Default vs saved sort, bounded-page indicator, selected-header accessibility, pending/stale | Fixture checks Ready/Desired ordering, numeric sorting and hidden available/total ratio semantics; never claims page sort is global total; condition search includes intended reviewed fields. |
| P2 : Pane Delete discoverability | Reuse existing `delete.rs`, not a second mutation path | Disabled/unknown, confirmation, accepted/uncertain | Pane Delete uses exact displayed UID/version and same confirmation as row; closing pane during pending operation does not replay or falsely cancel server effects. |
| P2 : Metrics / Pod CPU-memory / time charts | Separate Rust `metrics.rs` extension and cancellable workload aggregate query service; do not aggregate missing metrics into zero health | Provider unavailable, permission denied, loading, no samples, partial/stale, selected time range | Fixture no metrics vs real zero separated; parent/scope switch cancels prior query; Pod-list metrics and time-range charts remain distinct. |
| P2 : Reviewed metadata coverage | `detail_facts.rs` bounded explicit metadata fields, redact/review annotations rather than whole-object forwarding | Omitted intentionally, absent, bounded/partial, stale | Adversarial annotations/managed fields cannot bypass size/safe-display policy; API identity stays visible; omission documented. |
| P3 / separately approve : Force Finalize | Dedicated dangerous controller finalize command, not normal delete reuse; patch permission, UID/version/epoch safeguards | Terminating with finalizers only, impact warning, confirm, conflict/uncertain | Fixture exposes only on terminating object with finalizers, checks safe baseline; normal delete never silently clears finalizers. |

No pinned-source rollback acceptance is asserted. A future rollout-history/undo design would need its own API semantics, ownership/baseline protection and tests rather than calling ReplicaSet scale a rollback.

## Verification limits and fixture leads

Static conclusions cover the exact sources above; installed feature flags, server authorization, admission, metrics providers, native context menus and real rollout behavior were not observed. Existing fixtures to run separately: `tests/{resource-tables,resource-create,resource-delete,detail-contract,permission-actions,permissions}.spec.ts`; Rust `connection/{resource_tests.rs,create_tests.rs,delete_tests.rs,detail_facts/tests.rs,details/tests.rs,permissions/tests.rs}`. They do not by existence establish missing Deployment child/actions parity. No claim of tests passing is made here.
