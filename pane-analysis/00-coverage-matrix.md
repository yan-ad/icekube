# Complete menu-to-pane coverage matrix

## Scope and counting rule

The first pass covered the requested Cluster/Workloads Overview messages, Nodes, Deployments, DaemonSets and supplied Service/Node images. This extension audits the **other panes too**.

Coverage is **41/41 built-in Kubernetes kinds**, counted once from `src/app/cluster/resourceViews.ts` plus Nodes, and separately lists dynamic custom instances and non-resource surfaces. A row means source analysis exists, not that the pane is complete, click-tested in Freelens, available on every server, or permission-granted. Several missing panes are intentionally reported as missing rather than omitted from the inventory. Global dialogs are distinguished from resource drawers.

The pinned Freelens source is `cd07118f843c4a69f937a319a37a7c12ef2c92d8` (`v1.10.3-533-gcd07118f`). Iceon initial HEAD remains `e71baf2d51d2be391485d52dd837f428dc8d21aa`; this audit inspected a concurrently dirty tree. Validation and exact limits: [expanded validation](15-expanded-validation.md). Existing first-pass results remain in [07](07-validation.md).

**Reader:** Name/Details opens a scoped generic inspector with bounded facts. **Specialized:** a distinct resource DTO/view. **Summary:** captured inventory facts, not a named detail request. **None:** no instance inspector/action entry exists. All generic readers share the metadata, Events, history and action-placement gaps in [06](06-shared-inspector.md), except where a specialized path overrides them.

## All built-in Kubernetes kinds

| # | Menu / kind | Current pane | Audit and main remaining information/actions |
| --- | --- | --- | --- |
| 1 | Nodes | Reader + typed Node facts | [02](02-nodes.md): extended metadata/provider/capacity/Pods/Events/history; Node shell, cordon/drain/edit missing; guarded table Delete exists |
| 2 | Workloads / Pods | Specialized | [08](08-pods-and-runtime.md): incomplete condition/container/probe/mount detail; Event coverage discarded in UI; patch/update edit mismatch; logs/exec/attach/forward and reduced YAML exist |
| 3 | Workloads / Deployments | Reader | [03](03-deployments.md): ReplicaSets/Pods/scheduling/Events/metrics; Scale/Restart/Edit missing |
| 4 | Workloads / DaemonSets | Reader | [04](04-daemonsets.md): images/node selectors/Pods/Pod Status/scheduling/Events; Restart/Edit missing, no reference Scale action |
| 5 | Workloads / StatefulSets | Reader | [09 StatefulSets](09-other-workloads.md#statefulsets): template/owned Pods/metrics/Events, Scale/Restart/Edit; existing service/revision scalar facts are not links |
| 6 | Workloads / ReplicaSets | Reader | [09 ReplicaSets](09-other-workloads.md#replicasets): template/owned Pods/metrics/Events, Scale/Edit; owner reference returned by Rust is not rendered |
| 7 | Workloads / ReplicationControllers | Reader | [09 RC](09-other-workloads.md#replicationcontrollers): selector column/status facts/embedded-scale alternative; don't copy upstream swapped Desired/Current cells |
| 8 | Workloads / Jobs | Reader | [09 Jobs](09-other-workloads.md#jobs): child Pods/status/template/job fields; Suspend/Resume/Edit missing; CronJob owner not rendered |
| 9 | Workloads / CronJobs | Reader | [09 CronJobs](09-other-workloads.md#cronjobs): template/scheduling fields/Jobs history; Trigger/Suspend/Resume/Edit missing |
| 10 | Config / ConfigMaps | Metadata-only reader | [10 ConfigMaps](10-configuration-and-scheduling.md#configmaps): upstream inline data/key Save intentionally withheld; no approved stored-content reveal/edit |
| 11 | Config / Secrets | Metadata-only reader | [10 Secrets](10-configuration-and-scheduling.md#secrets): type/keys/encoded values/reveal/save intentionally withheld; creation does not authorize reading stored secrets |
| 12 | Config / ResourceQuotas | Reader | [10 Quotas](10-configuration-and-scheduling.md#resourcequotas): arbitrary quota resources/scope selectors/paired usage, name-form alternative vs YAML create |
| 13 | Config / LimitRanges | Reader | [10 Limits](10-configuration-and-scheduling.md#limitranges): storage/ephemeral/ratio and grouping gaps; existing CPU/memory facts present |
| 14 | Config / HorizontalPodAutoscalers | Reader | [10 HPA](10-configuration-and-scheduling.md#horizontalpodautoscalers-hpas): metric current/target types/details; reviewed target relation exists, not a dedicated scale editor |
| 15 | Config / VerticalPodAutoscalers | Reader | [10 VPA](10-configuration-and-scheduling.md#verticalpodautoscalers-vpas): update/resource policies and recommendations; target relation exists |
| 16 | Config / PodDisruptionBudgets | Reader | [10 PDB](10-configuration-and-scheduling.md#poddisruptionbudgets): selectors/health and disrupted-Pod interpretation, no invented eviction control |
| 17 | Config / PriorityClasses | Reader | [10 Priority](10-configuration-and-scheduling.md#priorityclasses): description/presentation fields; value/global/default facts not effective scheduling guarantees |
| 18 | Config / RuntimeClasses | Reader | [10 Runtime](10-configuration-and-scheduling.md#runtimeclasses): scheduling/tolerations beyond handler/overhead |
| 19 | Config / Leases | Reader | [10 Leases](10-configuration-and-scheduling.md#leases): scalar coverage strong; renewal timestamp is not leadership/health verification |
| 20 | Config / MutatingWebhookConfigurations | Reader | [12 Mutating](12-access-and-admission.md#mutatingwebhookconfigurations): matching rules/selectors/review versions/reinvocation; no raw CA/client URL exposure |
| 21 | Config / ValidatingWebhookConfigurations | Reader | [12 Validating](12-access-and-admission.md#validatingwebhookconfigurations): matching/review information; shared reference renderer doesn't authorize mutating-only schema fields |
| 22 | Config / ValidatingAdmissionPolicies | Reader | [12 Policy](12-access-and-admission.md#validatingadmissionpolicies): CEL/variables/audit/rules diagnostics absent; counts are not expression inspection |
| 23 | Config / ValidatingAdmissionPolicyBindings | Reader | [12 Binding](12-access-and-admission.md#validatingadmissionpolicybindings): matching/parameter selectors; policy link exists; action strings aren't mutation controls |
| 24 | Network / Services | Reader | [05](05-service-screenshot-reference.md): Managed Fields/LB details/EndpointSlices/Events/Service forwarding and edit missing |
| 25 | Network / EndpointSlices | Reader | [11 Slices](11-network-and-storage.md#endpointslices): address/port counts vs rows, Zone/targetRef/Node links; explicit false should be retained |
| 26 | Network / Endpoints | Reader | [11 Endpoints](11-network-and-storage.md#endpoints): ready/not-ready subset grouping/targetRef links, address:port text vs counts |
| 27 | Network / Ingresses | Reader | [11 Ingress](11-network-and-storage.md#ingresses): LB/TLS-name/routes/metrics; class link exists; external route opening needs Rust review |
| 28 | Network / IngressClasses | Reader | [11 Classes](11-network-and-storage.md#ingressclasses): parameter namespace/default status/arbitrary parameter relation; Set as default is a multi-object write, not preference |
| 29 | Network / NetworkPolicies | Reader | [11 Policies](11-network-and-storage.md#networkpolicies): actual ingress/egress peer/port/range/selector bodies missing; counts don't explain rules |
| 30 | Storage / PersistentVolumeClaims | Reader | [11 PVC](11-network-and-storage.md#persistentvolumeclaims): requested-vs-capacity Size, referencing Pods/selectors/metrics; no proven upstream dedicated resize dialog |
| 31 | Storage / PersistentVolumes | Reader | [11 PV](11-network-and-storage.md#persistentvolumes): detail coverage/provisioner options; Claim/StorageClass links present; no invented upstream CSI/affinity inspector |
| 32 | Storage / StorageClasses | Reader | [11 SC](11-network-and-storage.md#storageclasses): parameters/topologies/mount options and defaults; params need reviewed redaction |
| 33 | Namespaces | Reader | [13 Namespaces](13-namespaces-events-and-custom-resources.md#namespaces): labels/Subnamespace/linked quota and limit collections, name-form alternative |
| 34 | Events | Reader | [13 Events](13-namespaces-events-and-custom-resources.md#standalone-events): Message/Source/Last Seen table missing; bounded detail facts exist; Field Path/full message diagnostics incomplete |
| 35 | Access Control / ServiceAccounts | Reader | [12 SA](12-access-and-admission.md#serviceaccounts): non-secret reference links partial; token reveal/kubeconfig export unsupported, not approved parity work |
| 36 | Access Control / ClusterRoles | Reader | [12 ClusterRoles](12-access-and-admission.md#clusterroles): bounded rules, structured edit/aggregation diagnostics incomplete; not effective access |
| 37 | Access Control / Roles | Reader | [12 Roles](12-access-and-admission.md#roles): bounded rules/structured rule editing, colon-name creation discrepancy |
| 38 | Access Control / ClusterRoleBindings | Reader | [12 CRB](12-access-and-admission.md#clusterrolebindings): subject links/edit/removal missing; correct cluster Role link present |
| 39 | Access Control / RoleBindings | Reader | [12 RB](12-access-and-admission.md#rolebindings): subject links/edit/removal missing; Role vs ClusterRole resolution is safer than upstream wiring |
| 40 | Access Control / PodSecurityPolicies | Reader when API served | [12 PSP](12-access-and-admission.md#podsecuritypolicies): bounded ranges/capabilities; removed API must be unavailable, not fake empty/supported |
| 41 | Custom Resources / Definitions | Reader | [13 CRD](13-namespaces-events-and-custom-resources.md#customresourcedefinition-definitions): schemas/printer columns/names, preferred/version detail and resource-to-instance gesture |

All 41 have a fixed generic scaffold Create/Delete mapping, but eligibility depends on resource/scope/permissions/identity. Do not interpret this as complete manifests, API availability, full editing, safe finalization, or source-identical action placement. Pods additionally have specialized mutation/runtime paths. Generic create validation is not the Users backend one-shot plan.

## Non-resource and dynamic panes

| Surface / entry | Current implementation | Report |
| --- | --- | --- |
| Cluster overview/messages | Snapshot metrics + warning table, related-object reader | [01](01-cluster-and-workloads-overview.md) |
| Workloads Overview/messages | Donuts/Event table + Event reader via menu | [01](01-cluster-and-workloads-overview.md) |
| Dynamic CR instances | Metadata-only table, plain Name; **no instance inspector** | [13](13-namespaces-events-and-custom-resources.md#dynamic-custom-resource-instances) |
| Users | Managed-ServiceAccount list/editor/review/apply, **not generic inspector or human registry** | [12 Users](12-access-and-admission.md#users--managed-serviceaccounts-not-upstream-user-crud) |
| Pod Logs | Bottom dock, bounded Rust stream/buffer, options/search/download | [08 Runtime](08-pods-and-runtime.md#logs-shell-and-attach-dock) |
| Pod Shell / Attach | Bottom dock, Rust kube exec/attach; input changes container processes | [08 Runtime](08-pods-and-runtime.md#logs-shell-and-attach-dock) |
| Pod reduced YAML / mutation confirmation | Specialized right inspector + confirmation dialog | [08 Pods](08-pods-and-runtime.md#pods) |
| Network / Port Forwarding | Specialized session table/Pod link/start dialog/Stop or Remove; no general Service forward | [11 Forwarding](11-network-and-storage.md#port-forwarding) |
| Helm / Charts | Cached inventory and captured summary, not full chart detail | [14 Charts](14-helm-and-other-dialogs.md#helm-charts-catalog) |
| Chart details | Summary only: README/version catalog/deprecation/Home/maintainers absent | [14 Detail](14-helm-and-other-dialogs.md#helm-chart-details) |
| Helm Install | Modal, explicit namespace/release/values, dry-run then confirmation | [14 Install](14-helm-and-other-dialogs.md#helm-installation-dialog-upstream-dock-workflow) |
| Helm / Releases | Inventory + summary; **no full values/resources/history pane or upgrade/rollback/uninstall** | [14 Releases](14-helm-and-other-dialogs.md#helm-releases-and-release-detailshistoryresourcesvaluesactions) |
| Catalog / Add config | Metadata import form + native path picker | [14 Catalog](14-helm-and-other-dialogs.md#catalog-add-config--add-web-link) |
| Catalog / Add web link | Saved-link form; saved-ID Rust opener only | [14 Catalog](14-helm-and-other-dialogs.md#catalog-add-config--add-web-link) |
| Cluster actions / Saved metadata | Informational modal, not live resource detail | [14 Metadata](14-helm-and-other-dialogs.md#saved-cluster-metadata-dialog) |
| Preferences / App / Proxy / Kubernetes / Editor / Terminal | Five sections in one global modal; persistence not proof of every backend effect | [14 Preferences](14-helm-and-other-dialogs.md#preferences-global-not-resource-drawer) |
| Create resource / Delete selected / row context | Shared generic dialogs/actions, per-kind schema and RBAC limits | [06](06-shared-inspector.md), [10](10-configuration-and-scheduling.md), [12](12-access-and-admission.md) |
| Legacy category parent URLs | Destination grids, **not resource detail panes**; sidebar parent click expands children | `navigation.ts:7-84`, `ClusterWorkspacePage.tsx`, `DestinationGrid.tsx`; shared behavior [06](06-shared-inspector.md) |

Updater/release-distribution internals, extension-contributed panes and arbitrary Kubernetes APIs outside this inventory are **not** included. A count of Preferences sections or dock modes is not mixed into the 41-kind denominator.

## Highest-priority cross-pane findings from the expansion

1. **Pod event completeness is lost at the frontend boundary:** denied/unavailable/partial may show no events. Backend reads exist; this is not a missing Event service.
2. **Pod permission/action mismatch:** Edit/Save permits update OR patch but confirmation/PUT requires update. Misleading enabled action, not evidence of unauthorized server write.
3. **Backend-only owner refs:** non-Pod workloads can return controlledBy but the renderer does not display it without an item column. Do not credit hidden relationships as navigation.
4. **Dynamic custom resources and Helm use weaker detail surfaces:** metadata rows or captured summaries, not full named object/chart/release readers. Their missing inspector/actions are explicit.
5. **Policy/count panes omit decision-critical structure:** NetworkPolicy rules, HPA metric targets/current values, VPA policies/recommendations, admission CEL and webhook matching; absence of Partial does not mean full coverage.
6. **Sensitive-data boundaries stay deliberate:** ConfigMap/Secret/token/chart values/driver options must not be blindly exposed to match upstream. Structural reference metadata can be reviewed separately.
7. **Users grants are exact rules, not “effective access”:** All namespaces uses ClusterRoleBindings; template prefixes do not validate resource scope or exclude sensitive reads.
8. **Process state and settings claims need precision:** local forward bind is not remote success; Stop registry removal isn't an awaited port-retirement barrier; saved preference values aren't proof the Helm/network/native consumer uses them.

Each resource chapter specifies Rust ownership, honest UI states and concrete proposed acceptance scenarios. This audit itself does not implement those changes or approve dangerous operations.
