# Workloads / Daemon Sets : source audit

Coordinating audit note: this chapter records the source-inspection pass. Executed fixture results, concurrent working-tree changes and unresolved validation failures are in [07: Validation](07-validation.md).

## Scope and provenance

“Daemon Stats” is interpreted as **DaemonSets / Daemon Sets**, not a metrics-only page or a new resource kind.

- Iceon root `/Users/user1/Kerjaa/icekube`: HEAD `e71baf2d51d2be391485d52dd837f428dc8d21aa`.
- Local behavioral reference `/Users/user1/Kerjaa/freelens`: HEAD `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, supplied version `v1.10.3-533-gcd07118f`. Both SHAs checked directly.
- 2026-10-29, **static source inspection only**. No tests/app execution, real credentials, API requests or mutations. No upstream edits or source adaptation. Existing test files are leads, not passing evidence.
- Read `DESIGN.md` resource table/namespace, loading/inspector, generic creation/deletion and Pod-specific editing/runtime sections. Preserve Astryx compact section shell and Rust-owned network/auth/process lifecycle. This audit is not a request to copy Electron infrastructure or enable unfinished actions.

Abbreviations: **I** Iceon root; **F** Freelens root; **FC** `F/packages/core/src`; **RC** `FC/renderer/components`; **KA** `F/packages/utility-features/kube-api/src`; **KO** `F/packages/kube-object/src`.

## Sources rechecked

- Iceon `src/app/cluster/{resourceViews.ts,ResourceTablePage.tsx,ResourceActions.tsx,ResourceInspector.tsx,RowContextMenu.tsx,ResourceSelection.tsx,detailApi.ts,ResourceCreate.tsx,ResourceDelete.tsx,createApi.ts,deleteApi.ts}`.
- Iceon `src-tauri/src/connection/{resources.rs,detail_facts.rs,details.rs,transport.rs,permissions.rs,delete.rs,create.rs}` and detail command wiring in `src-tauri/src/lib.rs`.
- Freelens `RC/workloads-daemonsets/{daemonsets.tsx,daemonset-details.tsx,daemonset-menu.tsx,store.ts,store.injectable.ts,metrics-details-component.tsx}`, `KO/specifics/daemon-set.ts`, `KA/endpoints/daemon-set.api.ts`, `KA/kube-api.ts`.
- Shared Freelens `RC/{kube-object-list-layout/kube-object-list-layout.tsx,item-object-list/content.tsx,table/table.tsx,kube-object-menu/kube-object-menu.tsx,kube-object-menu/kube-object-delete-service.injectable.ts,kube-object-details/kube-object-details.tsx,kube-object-meta/kube-object-meta.tsx}` and `FC/common/{item.store.ts,k8s-api/kube-object.store.ts}`.
- Pod helpers `RC/workloads-pods/{pod-details-list.tsx,pod-details-statuses.tsx,pod-details-tolerations.tsx,pod-tolerations.tsx,pod-details-affinities.tsx}`; shared `RC/events/{kube-event-details.tsx,store.ts}`; generic edit `RC/dock/edit-resource/edit-resource-model/{edit-resource-model.injectable.tsx,request-patch-kube-resource.injectable.ts}`.
- Metrics registration `FC/features/metrics/metrics-feature.ts`; `RC/kube-object-details/kube-object-detail-items/metrics/{daemon-set-details-metrics.injectable.ts,get-metrics-kube-object-detail-item.injectable.tsx}`. Deployment and ReplicaSet list/detail/menu/store were also checked to distinguish features that do **not** belong to DaemonSets; see [Deployments](03-deployments.md).

`docs/freelens-detail-parity.md` was consulted only after checking sources. DaemonSet does have an Images block and Pod Status block; Deployment does not have those blocks at this pin. Neither should be inferred merely from a shared workload label.

## Table: exact columns and ordering

Freelens `daemonsets.tsx` declares `isConfigurable`, table ID `workload_daemonsets`, no default-hidden columns:

| In declared order | Freelens source value / sort | Iceon |
| --- | --- | --- |
| Name | `getName()`, name sortable | Name button to inspector. |
| Namespace | namespace badge, namespace sortable | Namespace relationship button opens Namespace details, not the same scope-change gesture. |
| Desired | `status.desiredNumberScheduled || 0`; numeric callback | Desired `/status/desiredNumberScheduled`. |
| Current | `status.currentNumberScheduled || 0`; numeric callback | Current key `scheduled`, same status field. |
| Ready | `status.numberReady || 0`; numeric callback | Ready `/status/numberReady`. |
| Updated | `status.updatedNumberScheduled || 0`; numeric callback | Updated same status field. |
| Available | `status.numberAvailable || 0`; numeric callback | Available same status field. |
| Node Selector | each `getNodeSelectors()` entry badge, tooltip, scrollable; **not sortable** | Missing from list projection/columns. |
| Age | age component; negative creation-timestamp callback | Projected creation age. |

Shared selection checkbox and menu cells surround these fields. Iceon order is `Name | Namespace | Desired | Current | Ready | Updated | Available | Age | Status`, plus checkbox and Actions. Extra Status is not an upstream DaemonSet column. Missing projected counts show `N/A`, not upstream's zero substitute. The latter should not be copied where “not reported” is more truthful.

Default ordering: DaemonSetStore does **not** override inherited ItemStore name-ascending sorting. There is no list-specific `sortByDefault`; shared Table URL `sort`/`order`/model settings can override. Contrast DeploymentStore's desired-replicas descending default, which must not be assigned to DaemonSets. Iceon sorts each bounded returned page `(namespace,name)` ascending, no header sorting or column configuration plugin; this is not global ordering across continuation pages.

### Status problem is semantic, not just visual

`I/.../resources.rs::workload_status` shares controller status handling: finds first condition of type **Available**, returns its status, or **Unknown**. Ordinary DaemonSet status commonly supplies scheduling counters rather than a Deployment-style Available condition. Therefore nonzero/all-ready counters can coexist with Unknown; this code does not derive readiness from those counters. Do not relabel Unknown as healthy or treat it as proof the workload is broken. `StatusBadge` also intentionally does not turn generic True/False into a readiness guarantee. The separate Desired/Current/Ready values remain useful.

### Controls/search/lifecycle

- Freelens configurable columns/resizing, shared namespace/search, checkboxes, selected removal, create/add and row menu. Search covers `getSearchFields()` (name/ns/UID/labels) plus labels again; **not** explicitly node selectors. Do not assume Node Selector text is searchable just because it is a visible column.
- Iceon namespace, debounced Search, Status, Clear filters; global Refresh/registered pagination; bottom-right Delete/Create. Rust search matches name/ns/status/projected column values, not metadata labels or node selector. Partial/bounded result count is not total cluster count.
- First-page ten-second polling, not workload watches. Only Pods has the explicit Live sync control. Namespace/filter/page changes cancel obsolete reads and reset selection; stale inventory disables destructive actions. Initial load, no items, filtered-empty, partial, first-load error, retained stale refresh error, denied/unknown permissions, disconnected and unavailable API must stay distinct.

## Pane field-by-field

Freelens `daemonset-details.tsx` guards null/wrong-instance input, subscribes PodStore on mount and disposes on unmount. Its exact local order is Selector, Node Selector, Images, Strategy Type, Tolerations, Affinities, Pod Status, Pods. Shared metadata/metrics/events come from separate detail registrations.

| Field / section | Freelens conditional behavior | Iceon generic pane |
| --- | --- | --- |
| Shared metadata | Created age/date; Deleted if present; name/ns; labels/annotations/finalizers; owner links; managed-fields toggles. UID/version/selfLink hidden by default | Name/ns, Created, UID/version, status and safe inventory facts; no equivalent raw metadata sections. |
| Selector | Only nonempty `spec.selector.matchLabels`; badges | Bounded selector label facts. Also expression key/operator facts, but expression **values omitted**, so `In`/`NotIn` meaning incomplete without automatic Coverage marker for that omission. |
| Node Selector | Nonempty template `spec.nodeSelector`; labelsOnly badges | Missing from both list and detail. |
| Images | Only nonempty; `getImages` concatenates regular **then init containers** and maps image; plain image rows | Missing. Do not list only regular containers if implementing. |
| Strategy Type | Always `spec.updateStrategy.type` | Update strategy projected; desired/current/ready/available/unavailable/updated/misscheduled extra status facts also present. No structured RollingUpdate maxUnavailable/maxSurge detail. These extra fields were not displayed by this upstream local pane. |
| Tolerations | Hidden empty; count toggle → Key / Operator / Value / Effect / Seconds table | Missing. Source declares sortable Value header without corresponding callback; copying this defect is not required. |
| Affinities | Hidden if zero top-level keys; count toggle → read-only YAML | Missing. Do not forward arbitrary template spec to renderer to achieve this. |
| Pod Status | Always DrawerItem wrapper; contents return null when no pods; counts `pod.getStatus()` values | Missing. This helper is phase/status **text counts**, not a CPU graph, not Ready/Desired, and not a Deployment phase-chart baseline. |
| Pods | Owned Pod list, described below | Missing section/relationship request. Standalone Pods page is present elsewhere. |
| Conditions | **No local KubeObjectConditionsDrawer invocation** in DaemonSetDetails | Generic trailing Conditions facts exist if status conditions array present: type/status/reason/transition; this is extra safe coverage, not a matched local upstream conditions UI. |
| Deploy Revisions | **No ReplicaSet revision list** in DaemonSet pane | Absent is not a DaemonSet parity gap. Do not graft Deployment → ReplicaSets onto DaemonSet. |
| Metrics | Separate metrics detail registration, order -1 and feature/provider gating; TimeRangedResourceMetrics + PodCharts | No workload metrics section. Registration does not prove runtime provider availability. |
| Events | Always-registered shared section; UID filtered, newest lastTimestamp first, message/source/count/sub-object/last seen, No events found | No workload-specific event read/section; standalone Events page/link to involved object exists, not the inverse relation. |

Iceon's `detail_facts.rs` DaemonSet section explicitly provides Desired scheduled, Current scheduled, Ready, Available, Unavailable, Updated scheduled, Misscheduled, Update strategy, then Selector/Selector expressions and optional Conditions. Generic section limits are 12 sections, 32 facts/section, 12 collection rows/selector keys, 1,024-byte safe scalar, 64-KiB conservative overall projection; Coverage marker reports actual type/limit omissions. Missing known scalar paths display Not reported. These bounds do not themselves disclose intentionally unimplemented nodeSelector/images/affinity content.

### Owned Pod relationship and shared Pod list

`DaemonSetStore.getChildPods` delegates to getPodsByOwnerId(DaemonSet UID), unlike DeploymentStore's template-label/namespace matching. The relationship is direct owner UID, not “same name”, selector only, or a count from desiredNumberScheduled. This is essential for replacement objects.

Shared `PodDetailsList`:

- Waits for PodStore load; spinner before loaded and hide after loaded-empty. More than 20 items virtualizes.
- Columns **Name | Node | Namespace | Ready | CPU | Memory | Status**. Node hidden only for Node owners, so visible here. Ready is running containers / containers; status uses `getStatusMessage()`.
- CPU three decimals without maxCpu; memory byte units without maxMemory. The DaemonSet call supplies no maxima. Metric-derived empty/zero must not become a readiness assertion.
- Name/node/namespace/CPU/memory sortable; default CPU descending with URL sorting disabled. Ready/status not sortable. Row/name opens Pod details; node/namespace links open their own details. No inline KubeObjectMenu rendered in this shared Pod list.
- Immediate metrics load and 120-second timer, restart on owner change, stop on unmount. Separate from the optional time-range PodCharts provider.

Iceon Pods already support richer details, protected YAML and runtime actions through Rust. They are **available elsewhere**, but there is no path from a DaemonSet child row because that list is absent. Revision/ReplicaSet scale actions belong elsewhere, not in this workload.

## Action reachability and dialogs

| Entry | Freelens | Iceon |
| --- | --- | --- |
| Row activation | Shared list toggles details for row selfLink; checkbox/menu cells stop propagation | Name button opens inspector; no page/plugin whole-row click activation. |
| Menu / right click | Registered DaemonSetMenu Restart plus generic Edit/Delete (or Force Finalize for terminating finalizers); shared list opens the row menu at the cursor on right-click (`RC/kube-object-list-layout/kube-object-list-layout.tsx:205-235`) | Actions button, right-click, ContextMenu/Shift+F10 invoke scoped native menu or browser fallback. **Details/Delete only** for DaemonSets. Permission review then authorization/fingerprint recheck. |
| Pane toolbar | Same KubeObjectMenu, `toolbar=true`: Restart + generic Edit/Delete | Refresh details, expand/restore, close only. Table Delete still accessible; no pane destructive controls. |
| Restart | Opens confirmation with DaemonSet name, Restart label; async API call with checked error notification | Missing end-to-end. |
| Edit | Hides details, opens generic dock YAML editing, saves JSON PATCH diff | Edit YAML in row menu is Pod-only; creation form is not edit. Missing DaemonSet baseline/edit/apply service. |
| Delete | Confirmation cluster and namespace/name; normal removal or Force Finalize when terminating and finalizers remain | Single row/checkbox batch confirmed deletion exists with stronger UID/resourceVersion protection. No generic force-finalize action. |
| Create | Shared generic create/add, no daemon-specific spec wizard evidenced here | apps/v1 DaemonSet metadata scaffold, explicit namespace, YAML, dry-run and confirmation; no complete controller spec generator. |
| Scale | **No DaemonSet scale menu/API** | Correctly absent as a DaemonSet operation. Node scheduling is not desired replicas and generic Pod/ReplicaSet scale elsewhere is not equivalent. |
| Rollback | **No DaemonSet rollback menu/API or deploy-revisions list in inspected sources** | Absent; not a proven pinned-reference gap. Helm rollback elsewhere is unrelated. |

### HTTP / RBAC semantics and safety

Freelens:

1. `DaemonSet.apiBase` is `/apis/apps/v1/daemonsets`; named requests insert namespace. Lists/detail/watch use shared API/store.
2. `DaemonSetApi.restart` performs **strategic merge PATCH `/apis/apps/v1/namespaces/{ns}/daemonsets/{name}`**, body `spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"] = new Date().toISOString()`. No `/restart` endpoint or Pod deletion. Whether an OnDelete strategy replaces Pods is controller behavior, not proved by patch success; do not claim restart completion.
3. Restart payload uses name/ns, no UID or resourceVersion precondition. Confirmation prevents accidental invocation but is not stale-object concurrency protection. Dismissal is not rollback of an in-flight patch.
4. Generic edit loads raw resource and computes JSON PATCH `createPatch(firstVersion,currentVersion)`; non-Pod path does not add a dedicated UID/version precondition. Saves through request-patch-kube-resource, not KubeApi.update's PUT just because that helper exists. Errors notify, success updates firstDraft.
5. `store.remove` → normal API DELETE by name/ns, Background query; no UID/version precondition supplied by that path. Force Finalize → merge PATCH `metadata.finalizers=[]`, not forced controller DELETE. Selected removal is Promise.all. Generic menu availability is store capability/kind based, not proof of Kubernetes authorization.
6. Actual required permissions: DaemonSet patch for restart/edit/finalize; delete for normal removal; Pod/event list/watch and metrics rights independent. Source presence cannot certify cluster RBAC. PodStore/event subscriptions and timers dispose; no Iceon-style exact monotonic identity cancellation is shown for controller restart dialogs.

Iceon:

1. Rust list and named GETs use allowlisted endpoints, bounded responses, session leases and cancel tokens. No renderer URL/network escape. Lists bounded to 100 returned matches, scans 10 pages/1,000 items/five seconds, explicit continuation/partial.
2. `details.rs` validates reference and response API/kind/name/ns/UID; requested UID mismatch → Conflict; `detailApi.ts` validates exact cluster/session/readId/reference/item. New detail request cancels preceding lane; monotonic IDs reject stale work; disposal cancellation ignores late replies. Refresh retains old facts with stale warning on error.
3. Pane's PermissionGate checks get; table checks list. Rust detail service does not itself call require_permissions, unlike write commands; Kubernetes remains authoritative for GET. Unknown is Access unverified, not read-only guarantee.
4. `delete.rs` requires verified get/delete, authorization-scoped client, preflight GET compares UID/version, DELETE sends Background DeleteOptions with **UID and resourceVersion preconditions**. Normal grace/finalizers preserved. Explicit accepted-vs-deleted result.
5. ResourceDelete confirms exact target(s), cluster/context/ns/name; sequential submission, failed targets remain selected, accepted targets deselected. Stop/Escape/disposal halts future submissions/cancels active work; sent request may already have reached API server. Outcome uncertainty and refresh before retry, not automatic replay. Scope/menu/authorization fingerprint changes invalidate stale actions.
6. ResourceCreate uses reviewed kind/namespace/name/YAML validation, verified create permission, **POST `?dryRun=All`**, then explicit-confirm POST without dryRun. Scaffold includes no workload spec until user supplies it. UID/resourceVersion create metadata rejected. Dry-run success not guaranteed later admission; post-send cancel uncertain.
7. Generic permissions Update/Patch exist, but no DaemonSet restart-specific mutation command and no DaemonSet scale subresource contract. Do not broaden capabilities/CSP or execute kubectl from renderer to fill the action gap.

## Prioritized gap ledger

Proposed owners retain Rust networking/auth/safety; these are proposed fixture acceptance scenarios, **not tests run**. New dangerous mutations need approved scope rather than speculative UI-only buttons.

| Priority / gap | Rust owner / contract | UI states | Acceptance scenario |
| --- | --- | --- | --- |
| P1 : Owned Pods and Pod Status | Extend `connection/details.rs` or dedicated `workload_relations.rs`: parent UID/session-scoped bounded Pods, per-relation permission/completeness; phase counts from returned relation with partial label | Loading, complete-empty, partial, denied, stale, replaced parent, canceled | Fixture two same-name DaemonSets with different UIDs, similarly labeled unowned Pod and >cap owned Pods: only correct UID children; phase counts never total when partial; cross-scope late read discarded; Pod row opens exact identity. |
| P1 : Scheduling/image detail | `detail_facts.rs` or typed scheduling DTO for template nodeSelector, regular+init images, tolerations, affinity and selector expression values | Absent vs unknown, collapsed/expanded, partial, malformed/unsafe values, stale | Fixture regular+init images, NoExecute seconds, affinity nested expressions and nodeSelector shown or omission explicit; full selector values preserved; no arbitrary template or credentials forwarded. |
| P1 : Restart | Dedicated Rust controller mutation service plus `permissions.rs` patch mapping, UID/version baseline, auth epoch, exact cancellation/outcome | Confirm, denied/unknown, submitting, conflict, patch accepted/rollout pending, OnDelete explanation, uncertain | Fixture asserts strategic timestamp patch; before-confirm cancel sends nothing; same-name replacement blocks; OnDelete patch success never claims Pods restarted; post-send disconnect reports uncertain and no replay. |
| P1 : Protected controller YAML edit | Rust baseline/dry-run/PATCH service; permission matches actual verb and target; safe reviewed object contract | Loading, dirty, invalid YAML, preview, denied, version conflict with draft retained, uncertain save | Fixture edit image/update strategy; immutable or rejected manifest and 409 preserve draft; stale UID/session/auth epoch cannot mutate; create route cannot overwrite existing object. |
| P1 : Related events diagnostics | `details.rs` bounded UID-filtered event query, independent rights and safe message limits | Loading, no events, unavailable/denied, partial/stale | Fixture event for another same-name UID excluded; newest first, source/count/time shown; denied events do not erase scheduling details. |
| P2 : Table Node Selector, search and sorting | `resources.rs` safe nodeSelector projection; `transport.rs` explicit search/order policy; frontend table view config | Default/custom sort, visible/hidden, bounded-page warning, pending/stale | Fixture nodeSelector visible, numeric counts sorted correctly, namespace defaults documented; search behavior intentionally specified; no global sort claim over a page. |
| P2 : DaemonSet status vocabulary | `resources.rs` dedicated daemonset summary instead of unqualified shared Available-condition scalar, if product approves derived status | Unknown/not reported vs ready/degraded/progressing, stale/partial | Fixture ready=desired but no conditions avoids invented Available True; desired>ready distinguishes not-yet-ready; missing counters remain unknown; zero desired not automatically failure or healthy without defined policy. |
| P2 : Metrics | Extend Rust metrics/query service, bounded/cancellable workload and Pod metrics; keep chart and phase-count contracts distinct | Provider unavailable, denied, zero vs no samples, loading/partial/stale, time range | Fixture no provider ≠ zero CPU; partial Pod list cannot masquerade as all-Pod aggregate; selecting another parent cancels old metrics; metrics failures do not hide Pod statuses. |
| P2 : Pane Delete entry | Reuse existing `delete.rs` and ResourceDelete confirmation | Disabled/unknown, confirming, submitting, accepted/uncertain | Pane action captures displayed UID/version; row/menu/toolbar cannot bypass review; pane closure during send never claims request undone. |
| P2 : Reviewed shared metadata | `detail_facts.rs` explicit safe metadata projection rather than raw object | Absent/intentionally omitted, bounded/partial, stale | Fixture adversarial annotations/managed fields cannot escape caps; omission policy visible; owner relationship UID kept; deletion timestamp shown only when reported. |
| P3 / separately approve : Force Finalize | Dedicated guarded Rust patch command, not ordinary delete; finalizers/terminating baseline and patch permission | Eligible only if terminating with finalizers, dangerous confirmation, conflict/uncertain | Fixture nonterminating object never offers finalize; exact UID/version/auth epoch enforced; normal delete never changes finalizers. |

There is no Scale or Rollback gap row because the pinned DaemonSet UI/API does not establish either operation. ControllerRevision history/undo would be a separately designed workflow, not Deployment ReplicaSet-table parity.

## Verification boundaries

Static reading establishes render paths, missing contracts and request construction, not successful native context menus, Kubernetes permission/admission decisions, real DaemonSet rollout behavior or production metrics. Existing fixture leads: frontend `tests/{resource-tables,resource-create,resource-delete,detail-contract,permission-actions,permissions}.spec.ts`; Rust `connection/{resource_tests.rs,create_tests.rs,delete_tests.rs,details/tests.rs,detail_facts/tests.rs,permissions/tests.rs}`. Main-agent test execution is separate; none were run for this report.
