# Pane analysis: Iceon compared with Freelens

Focused implementation follow-up: [18: Node Drain](18-node-drain-implementation.md) records the delivered conservative review/cordon/eviction workflow, tests and intentional differences from upstream force-drain behavior. Node shell and historical metrics are still separate pending work.

**Expanded scope:** the audit now covers **all 41 built-in Kubernetes kinds**, dynamic custom resources, Users, Helm, Pod runtime/dock, forwarding and global dialogs, not only the original five workflows. Start with the [complete coverage matrix](00-coverage-matrix.md). This is source-and-fixture analysis, not a live walkthrough of every reference pane.

**Current implementation follow-up:** [16: Implementation status and remaining gaps](16-implementation-status.md) reconciles these historical source-audit findings with the current dirty implementation tree. Substantial bounded readers, metadata, related collections and guarded operations are now implemented, but complete Freelens parity is not established. Read that ledger before treating the older missing-feature lists below as current; final validation totals remain coordinator-owned.

## Result

**None of the originally requested workflows has complete information-and-action parity with the pinned Freelens implementation.** The expanded review also finds partial generic readers, a specialized but incomplete Pod inspector, metadata-only dynamic CR inventories without instance panes, and Helm summaries instead of full detail readers. Iceon has working inventories, permission feedback and guarded deletion; those capabilities do not establish every field/action integration.

This is an analysis deliverable, not an implementation. No UI/backend source changes, cluster mutations, terminals, port forwards, credential reads or native application interactions were performed by this audit. Screenshot examples are compared by field/control, not by copying cluster names, addresses or annotations into this report.

### First-pass workflows

| Requested item | Detailed report | Main verdict |
| --- | --- | --- |
| 1. Cluster Message | [01: Cluster and Workloads Overview](01-cluster-and-workloads-overview.md) | Message text is not an inspector trigger. Involved-object buttons work through a protected relation read. Warning Events are not Freelens's combined Node-condition/Event issue model. |
| 2. Nodes | [02: Nodes](02-nodes.md) | Core table columns and several system facts exist. Metadata, provider ID, extended capacity, Node-associated Pods/Events, history and Node operations remain incomplete. |
| 3. Workloads > Overview Message | [01: Cluster and Workloads Overview](01-cluster-and-workloads-overview.md) | Event Details exists in the context/Actions menu, not a direct Message/row click. Namespace and title navigation do not preserve Freelens's shared filter behavior. |
| 4. Workloads > Deployments table and pane | [03: Deployments](03-deployments.md) | Count fields exist; Conditions/table interactions differ. Related ReplicaSets/Pods, scheduling information, object Events, Scale/Restart/Edit and pane Delete are missing or elsewhere. |
| 5. Daemon Stats | [04: DaemonSets](04-daemonsets.md) | Interpreted as **DaemonSets**, the existing Workloads menu. Counts exist, but node selectors/images/scheduling/owned Pods/Pod Status/Events and Restart/Edit are missing. |
| Attached Service pane examples | [05: Service screenshot reference](05-service-screenshot-reference.md) | Basic networking/ports exist. Managed Fields, several LoadBalancer fields, EndpointSlices, Events and Service-specific forward/edit actions do not. |
| All right-hand panes | [06: Shared inspector](06-shared-inspector.md) | Scoped reader and lifecycle safeguards exist; URL/history, whole-row activation, title copy, persistence, related collections and toolbar composition differ. |
| Test evidence and limitations | [07: Validation](07-validation.md) | Separates source findings, supplied-image observations, fixture execution and unverified native/live behavior. |

### Other panes: expanded audit

| Family | Report | Individually covered |
| --- | --- | --- |
| Coverage inventory | [00: Complete matrix](00-coverage-matrix.md) | All 41 kinds plus dynamic and non-resource surfaces; no missing pane hidden from inventory |
| Pods and runtime | [08: Pods and dock](08-pods-and-runtime.md) | Pod details/containers/conditions/events/YAML/mutations, logs, shell, attach and Pod-forward entry |
| Other workloads | [09: Other workloads](09-other-workloads.md) | StatefulSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs |
| Configuration and scheduling | [10: Configuration](10-configuration-and-scheduling.md) | ConfigMaps, Secrets, quotas, limits, HPA, VPA, PDB, PriorityClass, RuntimeClass, Lease |
| Network and storage | [11: Network/storage](11-network-and-storage.md) | EndpointSlices, Endpoints, Ingress, IngressClass, NetworkPolicy, PVC, PV, StorageClass, standalone forwarding |
| Access and admission | [12: Access/admission](12-access-and-admission.md) | ServiceAccount, Role/ClusterRole, bindings, PSP, managed Users, both webhook kinds, admission policy/binding |
| Namespace/Event/custom panes | [13: Namespaces, Events, CRs](13-namespaces-events-and-custom-resources.md) | Standalone Namespaces/Events, CRDs, dynamic CR instances |
| Helm/global dialogs | [14: Helm and dialogs](14-helm-and-other-dialogs.md) | Charts/details/install, Releases/details/history/actions, Catalog forms, saved metadata, Preferences |
| Extension test evidence | [15: Expanded validation](15-expanded-validation.md) | Exact fixture subset, diagnostic probes, source-only findings and unresolved limits |

## Provenance and how to interpret the evidence

- Audit date: 2026-10-29.
- Iceon project: `/Users/user1/Kerjaa/icekube`, initial HEAD `e71baf2d51d2be391485d52dd837f428dc8d21aa`, package version `0.0.6`.
- Local Freelens reference: `/Users/user1/Kerjaa/freelens`, HEAD `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, Git description `v1.10.3-533-gcd07118f`. The checkout was clean when pinned. This development revision is not a claim that the screenshot application used that version.
- Iceon had unrelated changes before this task, and additional unrelated files changed while it ran. Source references describe the files inspected against this baseline, **not a cryptographically frozen release or a clean-HEAD-only audit**. See validation for details. This task did not revert, commit or modify that other work.
- Only the currently supplied **Service and Node** images are image evidence. Cluster, Workloads Overview, Deployments and DaemonSets are compared from source and fixtures, not from unavailable earlier images.
- The workflow documents are source-audit chapters. Their statements that tests were not executed refer to those individual source passes; the coordinating validation run is recorded separately in [07](07-validation.md).
- Extended workflow passes 08-14 have the same source-only boundary; their coordinating fixture execution and diagnostic probes are recorded in [15](15-expanded-validation.md). All table fields, conditional sections, action chains, permissions, identity/lifecycle limits, Rust owners and proposed acceptance cases are kept per kind rather than credited from a shared component name.
- Source anchors are file/line references; `packages/...` belongs to Freelens, `src/...`, `src-tauri/...` and `tests/...` to Iceon. Abbreviated paths inside chapters have an explicit source-root key.
- No parity percentage is assigned. There is no measured feature denominator, and fixture success does not establish missing features or real-cluster equivalence.

**Classification:** present = a concrete implementation exists; partial = equivalent purpose with differing information or behavior; missing = no implementation at that entry point; elsewhere = working capability exists but is not integrated here; intentional = security/architecture/product alternative to retain. Source-only observations are not successful runtime claims.

## Click targets must match individually

| Gesture | Freelens | Current Iceon |
| --- | --- | --- |
| Cluster issue Message/row | Affected resource pane, not an Event pane | Message inert; Involved object button first resolves the Event relation, then navigates to affected resource/pane |
| Workloads Overview Event Message/row | Event pane | Message inert; Actions/context Details opens Event pane |
| Workloads Event Involved Object | Affected-resource pane | Protected Event relation resolution, target-section navigation, then target pane |
| Table resource Name | Resource pane | Typed resource pane |
| Ordinary resource row background | Toggle resource pane | No equivalent whole-row activation in inspected table wiring |
| List Namespace badge | Change contextual namespace filter | Opens Namespace details; this is not the same action |
| Pane Namespace link | Namespace details | Namespace route and details, same inspection purpose |
| Checkbox / Actions button | Must not activate row | Separate selection/context controls; retain that isolation when adding row activation |
| Related Pod/ReplicaSet/EndpointSlice row | Open related object's details | Associated rows absent in the requested parent panes, even though standalone kinds exist |

## Prioritized findings

Additional high-priority findings from the other panes:

- **Pods:** Rust returns Event coverage states but the frontend omits them; denied/unavailable/partial can read as empty. Edit/Save enables on patch-only rights although Replace is PUT/update. Specialized detail reads lack generic read-ID cancellation.
- **Workload owner links:** Rust may emit `controlledBy` for a non-Pod workload, but only Pods project the corresponding column; the inspector renders links through item columns. This is backend capability, not reachable owner navigation.
- **Policy diagnostics:** NetworkPolicy rule bodies, HPA metric details, VPA policies/recommendations and admission CEL/matching are incomplete. A count is not the corresponding rule or expression inspector.
- **Custom resources / Helm:** dynamic instances have no detail activation; Charts/Releases open captured summaries, not full readme/values/resources/history panes. Upgrading, release rollback and uninstall are missing, unlike the absent controller rollback action in the pinned reference.
- **Users and settings:** All namespaces creates ClusterRoleBindings from exact template rules; prefixes do not constrain effective access. Saved Helm/proxy/server-side preference values alone do not prove those consumers use them.

The [coverage matrix](00-coverage-matrix.md) and chapters 08-14 give per-pane evidence and acceptance ownership. Missing sensitive-data reveal/export remains an intentional boundary, not approval to implement it.

### P1: information and interaction completeness

1. **Message activation and correct destination.** Implement keyboard-operable direct message/row inspection with distinct semantics: Cluster issue -> affected object; Workloads Event -> Event. Do not just attach the same handler to both.
2. **Diagnostic completeness.** Event messages are capped at 256 UTF-8 bytes in the inventory projection and are not restored by the generic Event detail facts. Add an explicitly bounded detail-message contract with truncation disclosure. Do not assume diagnostic text is secret-free.
3. **Related sections.** Node -> Pods; Deployment -> ReplicaSets and matching Pods; DaemonSet -> owned Pods; Service -> EndpointSlices; each parent -> associated Events. Preserve exact namespace/session/UID and explicit association semantics, independent permission/errors and bounded coverage.
4. **Shared metadata and conditional detail.** Add only reviewed, bounded labels/annotations/finalizers/managed ownership fields. Managed Fields Show is read-only, not an edit action. Empty, false, absent, withheld and truncated must remain distinguishable.
5. **Scheduling/controller content.** Node selectors, tolerations, affinity and DaemonSet regular/init images are absent; expression values omitted from Iceon's selector facts can lose `In`/`NotIn` meaning. Node extended capacity keys are silently omitted.
6. **Namespace continuity.** Overview namespace changes are local; title links and list namespace gestures do not implement Freelens's shared filtering. Changing the visible menu without carrying scope is not equivalent behavior.

### P1/P2: approve action contracts before adding controls

- Deployment Scale, Deployment/DaemonSet Restart and non-Pod YAML editing require real Rust operation contracts. They are not implemented merely because generic Patch/Update permission names exist.
- Node shell/cordon/drain require a separate operational design. The reference Node shell creates a privileged host-access helper Pod; reference drain uses destructive kubectl flags. These are not harmless missing icons.
- Ordinary Delete is implemented from table/selection, but not those inspector headers. Reuse its guarded path rather than building a second weaker mutation path.
- Service Forward requires a Service-specific identity and port-resolution contract. Never send a Service name to the existing Pod-forward command or expose a renderer opener to mimic the reference.

### P2: table and inspector usability

- Sortable/configurable columns, full condition presentation, exact timestamp/tooltips and per-object scroll/history behavior differ.
- Node search excludes displayed internal IP/condition text; custom True conditions are hidden in the default summary.
- Workloads retained inventory lacks visible pending-refresh/stale feedback, although refresh failures are disclosed.
- Node condition data is duplicated as badges and generic facts.
- Metrics Server snapshots are not time-series charts. Missing samples must not become zeros; Node used/allocatable values must not be presented as upstream usage/requests.

## Action availability matrix

`Table` means a current row-context or selected-item workflow, not a pane toolbar.

| Action | Node | Deployment | DaemonSet | Service |
| --- | --- | --- | --- | --- |
| Inspect / refresh / close | Present | Present | Present | Present |
| Delete | Table, guarded | Table, guarded | Table, guarded | Table, guarded |
| YAML Edit | Missing | Missing | Missing | Missing |
| Force Finalize | Missing generic path | Missing generic path | Missing generic path | Missing generic path |
| Shell | Missing privileged Node workflow | Not a built-in controller action | Not a built-in controller action | Not a built-in Service action |
| Cordon / Uncordon / Drain | Missing | Not applicable | Not applicable | Not applicable |
| Scale | Not applicable | Missing | **Not a reference DaemonSet action** | Not applicable |
| Restart template rollout | Not applicable | Missing | Missing | Not applicable |
| Port forward from pane | Not applicable | Not a direct controller action | Not a direct controller action | Missing; Pod forwarding exists elsewhere |
| Rollback | Not established here | **Not in pinned Deployment menu/API** | **Not in pinned DaemonSet menu/API** | Not applicable |

No actions in this table were invoked against a cluster. Dialog dismissal and cancellation after submission are not rollback, and an accepted mutation is not proof of eventual controller completion.

## Corrections to earlier notes

`docs/freelens-detail-parity.md` is useful background but not exhaustive authority:

- Pinned DeploymentDetails does **not** contain an Images field or local Pod Status component. DaemonSetDetails does contain both. Do not copy their requirements between kinds.
- Deployment revision rows are ReplicaSets; their menu offers ReplicaSet actions, not a proven Deployment rollback operation.
- DaemonSets have no Scale action or ReplicaSet revision section in this reference.
- Node pause means Cordon/Uncordon, not pause metrics or watch.
- Service External IPs upstream uses precedence-based address selection, not simply the `spec.externalIPs` array.
- Existing creation scaffolds, generic deletion and specialized Pod runtime features must not be described as globally absent just because the corresponding parent-pane button is missing.

## Implementation boundaries

Follow `DESIGN.md`: preserve the Astryx shell and Rust-owned networking, credentials, filesystem, sessions and processes. This comparison is not permission to port Electron/Node, reveal raw Secret/ConfigMap bodies, open arbitrary external URLs, or execute privileged operations. Proposed owners and acceptance scenarios are in each chapter; they are not implemented or passing tests.

Validation summary: `bun run build` passed and the final isolated existing-behavior sweep passed **53/53** checks. Earlier failures, an unstable Nodes setup case and the Rust contract build timeout are retained in [07: Validation](07-validation.md); no native/live-cluster equivalence is implied.

Expanded validation: build passed; **93/94** additional selected checks passed, with a reproducible Preferences save-feedback failure (**3/3** repeats). Two read-only Pod probes confirmed the Event-state and permission-enabling gaps; a Preferences probe confirmed persistence despite missing feedback. See [15](15-expanded-validation.md). These are observations, not implementation fixes.

This report describes independently analyzed behavior. No upstream implementation was copied. Any later source adaptation must retain its applicable Freelens/OpenLens copyright and full MIT notice. No extension-compatibility or live-cluster parity claim is made.
