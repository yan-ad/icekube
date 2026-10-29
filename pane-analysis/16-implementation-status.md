# Implementation status ledger

## Purpose and evidence boundary

This ledger is the current source-of-truth summary for the pane-analysis family sheets. It is intentionally a status ledger, not a parity declaration. Iceon now contains substantial working implementation across the catalog, bounded resource readers, related collections, guarded actions, metadata projections, Helm details, custom-instance snapshots, and the shared inspector. The remaining work is still material. The sheets do **not** establish complete Freelens information-and-action parity, and this report does not say all panes are done.

The inspected source is the moving Iceon tree at HEAD `040667957cb29c31b15158bf4a3eb9bb4674b6ea`. The working tree is dirty, with concurrent changes in Rust, React and tests. HEAD is therefore a baseline label, not a frozen release identity. The pinned behavioral reference remains Freelens `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, described as `v1.10.3-533-gcd07118f`.

This is source and fixture evidence only. No credentials or real kubeconfig were read, no network or live Kubernetes operation was performed, no native application review was performed, and no cluster mutation, terminal, exec, attach, port forward, Helm install or deletion was sent. Operational code is present and was authorized for review, but source wiring and mocked IPC do not prove server acceptance or completed effects.

## Status vocabulary

- **Present**: current source has a usable implementation for the stated bounded purpose.
- **Present, restricted**: implemented, but deliberately narrower than Freelens because of data minimization, Rust ownership, bounded reads, or product policy.
- **Partial**: a meaningful equivalent exists, but fields, associations, interaction, freshness, or semantics remain incomplete.
- **Blocked**: work needs a separate security, destructive-operation, privilege, or product decision before exposing a control.
- **Policy or permanent intentional difference**: not a parity defect to remove by copying Freelens. It remains part of the product contract and must stay clearly labelled.
- **Unverified**: source or fixture evidence is insufficient to claim native, live-cluster, API-server, admission, RBAC, subprocess, or end-to-end behavior.

No percentage is assigned. The inventory contains 41 built-in kinds, but a kind count is not a feature denominator and does not measure fields, actions, runtime effects, or reference parity.

Source anchors for this follow-up are repository-relative: Rust `src-tauri/src/connection/{detail_metadata.rs,detail_facts.rs,detail_collections.rs,event_diagnostic.rs,details.rs,resource_edit.rs,workload_actions.rs,node_actions.rs,service_forward.rs,helm.rs,custom_resources.rs}` and command registration in `src-tauri/src/lib.rs`; React `src/app/cluster/{ResourceInspector.tsx,ResourcePaneDelete.tsx,ResourceEditor.tsx,DetailCollections.tsx,detailCollectionsApi.ts,resourceEditApi.ts,NodeActions.tsx,WorkloadActions.tsx,HelmDetails.tsx,HelmTablePage.tsx,CustomInstanceInspector.tsx,CustomResourceTable.tsx,NamespaceScope.tsx,namespaceStore.ts,resourceViews.ts}`. Chapters 00-15 retain their historical audit and acceptance lists. Their old missing-feature wording is not evidence that the newer implementations are absent.

## Cross-pane implementation ledger

| Area | Current status | What is actually implemented | Remaining gap or boundary |
| --- | --- | --- | --- |
| Shared inspector | **Present, partial** | Scoped Rust named reads, exact kind/name/namespace/UID checks, stale retention, cancellation, resize, expand/restore, close/Escape and focus return. | Freelens-style URL/deep-link/history behavior, durable pane history/scroll policy, full toolbar composition and all shared metadata are not complete. Native OS behavior is unverified. |
| Metadata | **Present, restricted, partial** | Rust-owned bounded labels, reviewed annotations, finalizers, deletion timestamp and managed-field ownership paths in generic detail readers. Sensitive-looking keys, unsafe values, controls, bidi, oversized values and Secret/ConfigMap metadata are filtered or marked partial. | This is not the unrestricted Freelens metadata view, nor the specialized Pod metadata DTO. Owner display, complete managed-fields presentation, full label/annotation semantics and per-kind coverage still need review. Recognizable credential filtering is not a guarantee that arbitrary text is secret-free. |
| Related collections | **Present, partial** | Rust `detail_collections` and React `DetailCollections` now provide bounded, cancellable, UID-scoped collections for Pods, ReplicaSets, Jobs, EndpointSlices, Events, ResourceQuotas and LimitRanges. Loading, empty, denied, unavailable, partial, stale and retry states are represented. | Association coverage is not universal. Node, workload, Service, Namespace and other family-specific relations still need field-level validation, pagination/freshness policy and exact navigation acceptance. A related row is not proof of complete cluster membership. |
| Event diagnostics | **Present, partial** | Bounded message/source/field-path diagnostic projection with truncation and credential-pattern redaction. Event collections and Pod event states are carried through current contracts. | Standalone and overview table interaction still differs from Freelens. Full event detail composition, relative/absolute time presentation and all source/field-path semantics remain incomplete. Diagnostic text is not guaranteed secret-free. |
| Resource editing | **Present, restricted** | Rust-owned reduced editing with Read, DryRun and Apply modes, bounded YAML/body sizes, permission checks, fresh identity/version checks, cancellation and conflict handling. The 14 reviewed kinds are Deployments, DaemonSets, StatefulSets, ReplicaSets, ReplicationControllers, Jobs, CronJobs, HPA, PDB, Nodes, PV, PVC, Services and StorageClasses (`resourceEditApi.ts`, `resource_edit.rs`). Workload scalars and existing controller-container image leaves are reviewed, not full templates. | This is not a full-object YAML editor. It does not authorize arbitrary annotations, scheduling edits, credentials, volumes, Secret/ConfigMap content or every Kubernetes field. Remaining kinds are not enabled implicitly. |
| Workload actions | **Present, partial** | Rust guarded controller action service covers scale for supported controllers, restart for Deployments/DaemonSets/StatefulSets, Job suspend/resume and CronJob suspend/resume/trigger. Actions have typed requests, permission checks, identity/session handling and cancellation paths. | UI and acceptance coverage must be checked for every supported kind. Accepted PATCH/POST is not rollout or job completion. CronJob trigger, controller restart and scale remain uncertain after submission and need refreshed state. |
| Node actions | **Present, restricted** | Rust `node_actions.rs` and React `NodeActions.tsx` implement Cordon/Uncordon with verified get+patch, UID/RV/scheduling-state review, confirmation, Stop, accepted/uncertain outcomes and refresh-required handling. | Node terminal/helper-Pod shell and drain remain absent. Native/live scheduling effects are unverified; cordon does not evict existing Pods. |
| Service forwarding | **Present, partial** | A Service-aware Rust forward path exists, with Service identity, backend resolution, Pod permission checks and tracked local forwarding ownership. | Backend selection, named target ports, headless/ExternalName/no-selector cases, failover, stop retirement and browser handoff need acceptance evidence. This is not proof of remote reachability. Renderer direct networking and arbitrary openers remain disallowed. |
| Pod runtime | **Present, restricted, partial** | Rust-owned bounded logs, shell, attach and Pod forwarding with stream limits, backpressure, UID checks, cancellation and cleanup ownership. Pod YAML remains reduced and mutation guarded. | Full Freelens fields, full log history/download behavior, time-series metrics, complete probes/mounts/security details and atomic replacement immunity remain incomplete. Closing a stream cannot undo remote process side effects. |
| Resource tables | **Present, partial** | Current `resourceViews.ts` has the 41 built-in kinds and explicit shared Name, Namespace, Age, Status and Actions composition. Rust bounded pagination, search, permission states, stale/error/partial states and selected namespace reads are present. | Table columns, sort/configuration, namespace gesture continuity and search fields do not match Freelens everywhere. Current page order is not global inventory order. Do not infer complete parity from the kind inventory. |
| Dynamic custom resources | **Present, restricted, partial** | CRD-scoped metadata inventory uses fresh CRD UID/version selection, served/storage resolution, PartialObjectMetadata, bounded pages, namespace checks and snapshot state. A named instance snapshot inspector now shows safe identity and provenance fields. | It is still a metadata snapshot, not a live named GET, full CRD printer-column/schema detail, arbitrary payload inspector, or dynamic create/edit/delete/finalize surface. Dynamic schema and named instance operations remain unimplemented or blocked. |
| Helm charts | **Present, restricted, partial** | Rust-owned cached chart inventory and chart detail/history metadata are bounded and cancellable. Chart details now have a distinct request path and explicit limits. | README, values, templates/manifests, maintainer/home/keywords, complete version catalog and repository verification are absent or intentionally withheld. Cached CLI data is not live repository verification. |
| Helm releases | **Present, partial, restricted** | Release detail and bounded revision history metadata are available through Rust-owned reads. The UI distinguishes partial history and explicitly says values, manifests, notes and rollback/uninstall are unavailable. | Full release values, user-only values, rendered resources/manifests, notes, upgrade, rollback and uninstall remain missing or separately blocked. Generic Kubernetes Delete is not Helm uninstall. |
| Namespace scope | **Present, partial** | Shared namespace store has bounded discovery, cached metadata, refresh, cancellation, known-name fallback and explicit partial/error states. `ResourceTablePage` and `WorkloadsOverview` use `useNamespaceSelection`; their namespace-cell buttons filter, while pane namespace links inspect. | Selection is single-namespace/all, not multi-select. `HelmTablePage` and `CustomResourceTable` still use local `useState("")` for selection despite sharing namespace discovery. All namespaces is scope, not authorization. |
| Catalog and persistence | **Present, restricted** | Rust-owned SQLite/catalog records, metadata-only kubeconfig import, default `~/.kube/config` discovery, symlink validation, saved web links, persisted colors/pins and saved-ID-only HTTPS opener are present. | Import is not authentication or connection. No renderer direct opener, arbitrary URL, `KUBECONFIG` scan, credential execution or live-cluster claim is allowed. |

## Family ledger

### Cluster and workload overview

**Present:** bounded Node and Warning Event snapshots, a distinct Node condition-warning table, current metrics-server aggregates, workload status widgets, namespace-scoped reads, stale/partial/error states, cancellation and protected relation navigation. Cluster Warning Event messages resolve the affected object; Workloads Event messages open the Event. Node warning-condition buttons open the Node.

**Partial:** Freelens cluster issues combine Node conditions and grouped Warning Events with affected-object activation. Metrics remain current snapshots, not time-series requests/limits/Pods charts. Workload statuses deliberately use Iceon policies and are not the same child-Pod status contract. Namespace continuity, total-count navigation, sorting and live watch behavior remain different.

**Next owner:** Rust overview/issues and metrics services, then React activation/scope wiring. Acceptance must cover duplicate warnings, recovered Pods, partial namespace/Event reads, long/redacted diagnostics, direct keyboard activation and stale scope replies.

### Nodes

**Present:** bounded inventory, current CPU/Memory samples with explicit denominator, Node facts, condition badges, capacity/allocatable projection, metadata projection, related Pods/Events collection path, guarded delete and typed Node action lane.

**Present restricted or partial:** metadata and capacity are bounded and omit unsafe/unreviewed fields. Resource views expose only selected fields. The implementation is not the Freelens Node pane.

**Remaining:** Node terminal/helper Pod shell, drain, time-series CPU/Memory/Disk/Pods charts, related-Pod metrics and richer child columns, optional configurable columns, internal-IP/condition search, custom-True summary visibility and complete screenshot field presentation. `NodesTable.tsx` still selects the four standard adverse conditions rather than every custom True condition; `transport.rs::matches_filter` still searches projected column strings rather than Node address/condition arrays. Cordon/Uncordon is implemented through `NodeActions.tsx`, not pending UI work. Rust owners are `node_actions.rs`, `detail_facts.rs`, `detail_collections.rs` and the metrics service. Privileged shell and drain need their own reviewed operation contracts; implementing operational code does not authorize executing it against a cluster.

**Screenshot capacity check:** a reference example with 36 labels exceeds the current metadata cap of 32. It must render partial coverage, not be declared a complete match. The same sensitive-key/value suppression applies to labels as annotations; managed fields show projected ownership paths, not the raw `fieldsV1` tree. These restrictions also do not supply missing owner-reference navigation or extend the specialized Pod metadata DTO.

### Deployments, DaemonSets and other workloads

**Present:** bounded tables, controller facts, reviewed template images/scheduling fields in the current fact projection, related collections for Pods/ReplicaSets/Jobs/Events where allowed, reduced editing, guarded delete, and typed scale/restart/suspend/resume/trigger action services where supported.

**Partial:** owner references can exist in Rust without being reachable links in every table. Related children are bounded subsets, not complete watches. Conditions, selector expressions, scheduling structures, Pod status and event diagnostics are still reduced. UI action placement and per-kind controls need reconciliation with the new Rust capabilities.

**Remaining:** child tables still lack Freelens-equivalent CPU/Memory and full revision/history presentation; selector/scheduling/condition facts remain bounded rather than full nested widgets. Verify every supported action's failure/cancellation states, parent/controller warnings and UID/RV/auth-epoch changes. CronJob trigger must retain template provenance and never blindly replay an uncertain Job POST. Do not add a DaemonSet Scale action or controller Rollback merely for parity: neither is established in the pinned reference.

### Pods and runtime dock

**Present:** specialized Pod inspector, bounded conditions/container projection, explicit Event state, reduced YAML, guarded replace/delete/force/finalize paths, logs, shell, attach and Pod forwarding with Rust ownership and backpressure.

**Present restricted or partial:** Event state now survives the DTO boundary and is rendered separately from empty. YAML and runtime controls remain intentionally reduced and bounded.

The earlier patch-only Edit mismatch is also corrected: current `PodDetailsView.tsx::canReplace` requires verified get+update, matching PUT replacement, not patch-only access. This correction does not add Pod resize or full-object editing.

**Remaining:** complete container last-state diagnostics, probes, requests/limits, mounts/volumes, scheduling/security references, metrics time series, full-log semantics, stream cancellation evidence and the residual name-based subresource race. Secret/env/credential reveal and unrestricted YAML remain policy-restricted.

### Configuration and scheduling

**Present:** metadata-only ConfigMap and Secret inventory, quota/limit/HPA/VPA/PDB/Priority/Runtime/Lease tables and bounded fact projections, plus webhook/admission policy projections and guarded generic create/delete.

**Partial:** policy bodies and metrics are now represented more broadly, but bounded facts are not full object editors. Quota arbitrary resource maps/scope selectors, LimitRange resource constraints including storage/ephemeral/ratio, HPA current/target lists, VPA recommendation bounds/policies and admission CEL/matching are now projected. Remaining work is structured grouping, metric identity/presentation, relation links and exhaustive omission/coverage tests, not adding these data families from scratch.

**Policy or permanent intentional:** Secret and ConfigMap contents, key names, token values, arbitrary annotations and raw YAML are not exposed merely to match Freelens. Existing-object edit/finalize for these families requires a separately reviewed Rust contract.

### Network and storage

**Present:** Service facts, Endpoint/EndpointSlice/Ingress/IngressClass/NetworkPolicy/PVC/PV/StorageClass tables, related EndpointSlices/Events where supported, Pod and Service forwarding paths, and bounded storage identity relations.

**Partial:** Endpoint grouping/target navigation, Ingress route details, PVC Pod association, StorageClass parameters/defaults and metrics remain incomplete. NetworkPolicy ingress/egress rule bodies and selectors now have reviewed projections; remaining work is structured rule presentation and explicit empty/omitted semantics. Service forwarding has a real Rust owner but still needs resolver and lifecycle acceptance.

**Blocked or intentional:** arbitrary external route openers, public bind addresses, UDP/SCTP forwarding, raw CSI/mount credentials and unreviewed storage parameters are not parity work without explicit policy.

### Access, admission and Users

**Present:** bounded ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding, PSP, webhook and admission-policy projections. Managed Users has a Rust-owned snapshot/plan/apply workflow with exact rules, dry-runs, UID/RV baselines, expiry, cancellation and per-step outcomes.

**Partial:** non-resource URLs, aggregation selectors, webhook matching/review versions and admission CEL/type warnings now have bounded projections. Subject navigation/editing and richer per-kind diagnostics/presentation remain incomplete. PSP is correctly unavailable when the removed API is not served.

**Policy or permanent intentional:** Managed Users is not Freelens user CRUD or an effective-access calculator. Template prefixes do not constrain the actual rules. Token reveal, kubeconfig export and unrelated-grant revocation remain unsupported.

### Namespaces, Events and custom resources

**Present:** Namespace table and scope store, standalone Event table/detail projection, CRD definition inventory/detail, dynamic CR metadata snapshots, and bounded collection sections.

**Partial:** Namespace quota/LimitRange child sections are now integrated but bounded, not complete reactive subscriptions. Dedicated Event table columns/time presentation, CRD schema viewing/version selection and dynamic instance named GET remain incomplete. CRD singular/listKind and per-version printer-column facts exist; arbitrary validation schema is deliberately withheld with partial coverage. Dynamic instance snapshots must not be described as full inspectors.

## Exact residuals by kind group

These rows supplement, rather than replace, the bounded cross-pane metadata/conditions/metrics limitations above. They reconcile the per-family gap lists with the current source.

| Kinds or surface | Present delta since the original sheets | Still missing, restricted or different |
| --- | --- | --- |
| Nodes | Provider ID, reviewed capacity/allocatable resource maps, metadata, Pod/Event collections, Cordon/Uncordon and reduced unschedulable edit. | Privileged Node terminal, drain, time-series/disk measurements, child Pod metrics, internal-IP/condition search, custom-True summary visibility, optional table columns and screenshot-level metadata completeness. |
| Deployments | Scheduling/image projection, ReplicaSet/Pod/Event collections, Scale/Restart, reduced YAML and pane Delete. | Complete revision widgets, child metrics, rich conditions and history. Image presence is an Iceon addition, not a missing block in pinned DeploymentDetails. |
| DaemonSets | Scheduling/images, bounded Pod Status/Pods/Events, Restart, reduced YAML and pane Delete. | Metrics, complete child/scheduling presentation and OnDelete rollout interpretation. No reference Scale or ReplicaSet revisions requirement. |
| StatefulSets | Pod/Event collections, scheduling/images, Scale/Restart/reduced edit. | Service-name relation, complete child metric table and historical charts. Scalar revision names are not rollback. |
| ReplicaSets | Pod/Event collections, scheduling, Scale/reduced edit. | Reachable controller-owner links in all views, complete child metrics/history and parent reconciliation explanation. No reference Restart action. |
| ReplicationControllers | Scale, reviewed readiness/selector/template facts and Pod/Event collection support. | Selector list column, exact desired/current presentation and rich embedded-scale alternative. Confirmed modal scaling intentionally differs from upstream auto-submit slider. |
| Jobs | Child Pods/Events, template facts, Suspend/Resume and reduced edit. | Duration list column, richer status/ready/completed-index diagnostics and metric history. No Job Trigger/Restart parity claim. |
| CronJobs | Owned Jobs/Events, template/scheduling projection, Trigger/Suspend/Resume/reduced edit. | Human schedule explanation, full Job history fields/ordering and all active-reference links. No dedicated CronJob metric history required by this reference. |
| ConfigMaps, Secrets | Metadata-only readers, user-input creation, guarded deletion. | Stored data, keys/type/reveal/save and unrestricted metadata/YAML are policy-blocked; new creation is not authorization to read stored contents. |
| ResourceQuotas, LimitRanges | Arbitrary quota hard/used maps, scopes/selectors and full reviewed constraint maps including ratios. | Paired quota usage/grouped quantity widgets, full budget coverage, upstream name/staging forms and editors beyond existing allowlist. Never turn absent used into zero. |
| HPA, VPA | Reviewed current/target metrics, policy/recommendation/recommender fields and target relations; HPA min/max reduced edit. | Typed metric matching/presentation, Object metric relation and rich conditions; VPA policy editor/full YAML absent. Separate current and target list order is not metric identity. |
| PDB, PriorityClass, RuntimeClass, Lease | PDB selector expressions/reduced edit, Runtime scheduling/tolerations/overhead and bounded scalar facts. | Rich condition messages, PriorityClass description/presentation review and full editing outside allowlist. Lease timestamps do not establish leadership. PDB is not an eviction control. |
| Services | appProtocol, IP mode/LB fields, EndpointSlice/Event collections, reduced edit, Rust Service forwarding and pane Delete. | Per-ingress status ports/errors, full conditional layout and forwarding/browser lifecycle parity. Related slice Ports/Endpoints remain reduced counts in current table projection, not upstream address/port rows. |
| EndpointSlices, Endpoints | Bounded port/address and explicit readiness facts; Event collections. | Zone/targetRef/Node navigation and full subset grouping; count list columns are not address strings. False readiness must stay distinct from absent. |
| Ingresses, IngressClasses | Existing class navigation, rule/path facts, parameter namespace and Events. | Ingress LB/TLS-secret-name/default named-port detail, metrics and approved route opener; arbitrary parameter links/default-class multi-write orchestration absent. |
| NetworkPolicies | Reviewed rule bodies, peers/selectors/ports and Events. | Grouped AND/OR rule explanation, complete nested bounds and generic editing absent. No effective connectivity/CNI enforcement claim. |
| PVC, PV, StorageClass | Reviewed claim selectors, PV affinity/mount options, StorageClass topology/mount options, existing identity links and reduced edits. | Referencing Pods, StorageClass-related PV list, params/default status, reviewed NFS/Flex details, metrics and PVC expansion. Reduced PVC editing is not a resize operation. |
| ServiceAccounts | Reference counts and non-secret scalar facts, Events and guarded generic actions. | Approved namespaced reference links; token reveal/kubeconfig export remain intentionally unsupported. |
| Roles, ClusterRoles | Bounded rules/non-resource URLs and aggregation selectors, Events, guarded create/delete. | Structured rule editor, complete beyond-cap inspection, colon-name creation compatibility and any effective-access analysis. |
| RoleBindings, ClusterRoleBindings | Bounded subject facts and kind-correct role links, Events, guarded create/delete. | Subject SA/Namespace links and structured add/remove editor. User/Group names are not Kubernetes resource links. |
| PSP | Bounded legacy facts/collections where API served. | Full capabilities/ranges/path details remain partial; removed API must be unavailable, never fake success or rename to Pod Security Admission. |
| Webhooks, admission policy/binding | Reviewed rules/selectors/review versions/CEL/variables/audit/type warnings and Events. | Complete grouped schema-specific presentation, safe parameter/Service links and arbitrary editing. Raw CA/client URL material remains restricted. |
| Namespaces, Events | Quota/LimitRange/Event collections; Event message/source/fieldPath diagnostic with explicit truncation. | Namespace Subnamespace/value table parity, Event Message/Source/Last Seen table columns, relative/absolute timestamps. Generic finalize remains absent, including namespace finalization. |
| CRD definitions, custom instances | CRD names/printer facts; clickable captured metadata snapshot for instances. | Schema viewer, Resource-to-instance gesture, discovery-only fallback, selected-version UX, instance named GET/status/printer evaluation and dynamic mutations. |
| Helm chart/release, install | Named scoped chart metadata/release history reads; existing guarded install. | Chart README/version catalog/Home/Maintainers/Keywords; release values/resources/manifests/notes; upgrade/rollback/uninstall. History has no descriptions and is not rollback. |
| Catalog, saved metadata, Preferences, Users | Existing Rust-owned forms/storage/managed-user plan flows. | Preferences consumer and modal feedback/lifetime verification; no new final test totals or implicit effective-rights/credential claims. Saved metadata is not live connection state. |

**Generic finalization remains missing.** Displayed finalizer names, ordinary pane Delete and a specialized Pod finalize path do not implement a guarded generic Force Finalize operation. Any such operation needs a separate get+patch contract, terminating/nonempty-finalizer checks, UID/RV/auth baselines and explicit cleanup-bypass warning. Full-object YAML is likewise not enabled merely because 14 reduced editors exist.

**Blocked:** dynamic create/edit/delete/finalize and arbitrary schema-driven payload exposure require a new CR-specific Rust authority and redaction contract.

### Helm and global dialogs

**Present:** cached chart/release inventory, bounded chart/release detail metadata, bounded release history, guarded Helm install with server dry-run then confirmation, Catalog forms, saved metadata and Rust-owned Preferences persistence.

**Partial:** chart README/version/repository provenance, release resources/notes/values and action workflows remain incomplete. Preferences persistence is present, but each setting's backend consumer is not proven by persistence alone.

**Policy or permanent intentional:** no renderer Helm subprocess, arbitrary chart URL, raw values/manifests/notes or secret-bearing release payload is exposed without a separate contract. Helm install is not evidence of upgrade, rollback or uninstall support.

## Minimum next-work acceptance checklist

This is the minimum prioritized work that would materially improve parity without claiming all sheets are complete. Each item needs Rust ownership, typed IPC, UI states and fixture evidence before it is credited.

1. **Complete shared metadata and related-section contract.** Owner: Rust `detail_metadata.rs`, `detail_facts.rs`, `detail_collections.rs`, `details.rs`; React `ResourceInspector.tsx`, `DetailCollections.tsx`. Cover labels, annotation omission, finalizers, managed ownership paths, owner links and collection states. Acceptance: same-name different-UID replacement, collection/fact overflows, 36 labels against the 32-label cap, unsafe/sensitive values, denied/partial/empty, cancellation and stale retention. Keep the 12-section/32-fact/12-item fact budget distinct from metadata's limits; a large object can displace fields despite a new schema branch being present.
2. **Finish message and Event fidelity.** Owner: Rust `event_diagnostic.rs`, `resources.rs`, `details.rs`; React overview/Event inspector. Acceptance: direct Cluster issue versus Workloads Event activation, message truncation disclosure, source/component distinction, field path, first/last timestamps, warning styling, keyboard behavior and no false empty state.
3. **Reconcile action UI with guarded Rust actions.** Owner: `workload_actions.rs`, `node_actions.rs`, `resource_edit.rs`, `ResourcePaneDelete.tsx`, `WorkloadActions.tsx`, `NodeActions.tsx`. Acceptance: exact supported-kind matrix, permission unknown/denied, UID/RV/auth epoch drift, cancel before submission, accepted/uncertain after submission, refresh-required wording and no duplicate mutation paths.
4. **Finish Node operational decision work.** Owner: proposed/expanded `node_actions.rs` and runtime ownership. Acceptance before exposing controls: privileged helper policy, shell lifecycle, cordon/uncordon state refresh, drain options/PDB/429/partial progress, disconnect cleanup and explicit approval. Until then classify shell/drain as blocked, not missing polish.
5. **Add metrics time-series contract.** Owner: Rust metrics/provider/query service. Acceptance: no provider, denied, no samples, real zero, stale, partial, time-range cancellation, node/workload/pod scope, bounded samples and no fabricated requests/limits/history. This is meaningful work, not a cosmetic chart task.
6. **Complete dynamic named reads safely.** Owner: Rust `custom_resources.rs` plus a typed named-instance DTO and React `CustomInstanceInspector`. Acceptance: fresh CRD UID/version, served version change, namespace scope, PartialObjectMetadata or reviewed payload policy, denied/missing/replaced states, printer columns and no arbitrary JSON/schema execution. Until then keep snapshot wording.
7. **Complete Helm detail only where approved.** Owner: Rust `helm.rs` and Helm detail services. Acceptance: chart repository/version provenance, README and values redaction policy, release resources/history limits, stale cache, same-name namespace separation and no raw Secret-bearing manifests. Implement upgrade/rollback/uninstall only as separate reviewed mutation services.
8. **Make namespace continuity explicit.** Owner: namespace store/scope, overview and resource table routing. Acceptance: one namespace selection model, multi-selection decision, category navigation retaining scope, Event namespace filter semantics, all-namespaces authorization distinction and late-read cancellation.
9. **Run the coordinator-owned verification pass.** Use the commands below on a pinned clean or explicitly recorded tree. Do not overwrite or aggregate per-agent totals until the coordinating run records one final result.

## Verification commands and limits

Recommended source/build checks, subject to the coordinator's final tree and environment:

```sh
bun run build
bun run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Use fixture/mocked IPC tests first for the acceptance items above. Do not use real kubeconfig, credentials, live clusters, auth plugins, Helm repositories, native windows or external networking as a substitute for a missing contract. Native review has not been performed here. Per-agent successful suites may be cited by their owning validation sheet, but this ledger intentionally leaves final suite totals to the main coordinating result.

## Final interpretation

Iceon is substantially implemented as a bounded, Rust-owned Kubernetes workspace. It is not a complete Freelens clone and should not be presented as one. The highest-value remaining work is not adding decorative parity controls. It is finishing the typed data contracts, related-resource fidelity, Event semantics, metrics history, namespace continuity and guarded action UI while preserving deliberate restrictions around secrets, raw objects, arbitrary URLs, privileged Node operations and uncertain submitted mutations.
