# Resource inspector reference

## Reference authority and scope

Local `/Users/user1/Kerjaa/freelens` HEAD was verified as `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, described by Git as `v1.10.3-533-gcd07118f`. Read sources under `packages/core/src/renderer/components/`: `kube-object-details/kube-object-details.tsx`, `drawer/drawer.tsx`, `custom-resource-definitions/view.tsx`, `custom-resource-definitions/details.tsx`, and `custom-resources/details.tsx`. They establish the object-details drawer and CRD reference workflows, not a completed per-kind parity comparison.

The inventory below is verified against Icekube source, not against Freelens. Icekube uses upstream inspector workflows as behavioral reference only, not Electron/Node implementation code or a parity claim.

## Ownership and contract

- `src-tauri/src/connection/detail_facts.rs`: explicit kind-specific scalar/array projection into section titles and label/value facts. No raw JSON serialization fallback.
- `src-tauri/src/connection/details.rs`: validated named-object GET identity, UID conflict checks, session/read ownership, cancellation, related-resource references, and composition with the existing inventory item.
- `src-tauri/src/connection/transport.rs`: fixed allowlisted resource paths; an ordinary 2 MiB response-body bound; Secret/ConfigMap `PartialObjectMetadata` Accept negotiation without a full-object fallback. CRD inventory starts at limit 10 and retries `LimitExceeded` at limit 1 using the same unconsumed token. A CRD limit-1 body is capped at 16 MiB; projected items are capped at 64 KiB per page and accumulated scan. The separate custom-instance path reads a verified named CRD within 16 MiB before metadata-only instance negotiation; this does not raise ordinary object/list limits or forward schemas.
- `src-tauri/src/connection/resources.rs`: inventory columns/status included alongside facts; Nodes also carry their separate typed node contract.
- `src/app/cluster/detailApi.ts`: closed IPC response shape, matching cluster/session/read/object identity, bounded facts and related references. `sections` remains optional for older fixtures.
- `src-tauri/src/lib.rs`: both `cluster_resource_detail` and
  `cluster_resource_detail_cancel` extract `tauri::State<'_, Arc<ConnectionEngine>>`,
  matching the engine registered by setup. Their previous `State<ConnectionEngine>`
  extraction mismatch caused a generic invocation failure across resource kinds,
  before a detail read could run. This is distinct from Kubernetes RBAC rejection.
- `details.rs` kind-aware name validation and path construction are shared with
  `resources.rs` inventory projection. RBAC names such as `system:Reader` are
  admitted without relaxing Pod/DNS name rules; names are percent-encoded as one
  path segment (`system%3AReader`). Traversal, slash, pre-encoded separators,
  query/fragment and control-character names remain invalid.
- Pods opened by name currently use the separate Pod detail API, not the generic facts transport: see `tests/resource-inspector.spec.ts`, test `Pod detail uses the Pod API in the inspector, never the bottom dock or generic detail API`. The generic Pod facts below describe backend support, not proof of that UI route rendering these sections.

### Inventory updates versus inspector reads

The surrounding inventory is no longer manual-only. `useAutoRefresh.ts` schedules
first-page bounded resource LIST reads 10 seconds after completion; Helm inventory
and Workloads overview use 30 seconds, with overview retaining its multi-page
budget. Rust services retain request/session ownership and cancellation. Reads
require visible/focused/online state and pause for editing, dialogs, menus/listboxes
and expanded popups; pending filters and active Pod Live sync pause ordinary
resource polling. Focus/visibility/online return can catch up without overlap or
bypassing backoff. Transient errors back off to at most 60 seconds, while terminal
errors stop automatic retries. Continuation pages stay manual snapshots, with no
automatic page jump. Resource/Helm background delivery waits during blocked
interaction; retained rows remain stale on failed updates, not silently current.

Inspector GET/YAML reads still use explicit Refresh and exact-object cancellation;
inventory polling does not automatically reload an editor or resubmit a mutation.
Cmd/Ctrl+R in a focused resource inspector is captured by
`ResourceInspector.tsx`, which prevents default and stops propagation before the
workspace handler can refresh the table behind it. It refreshes only the selected
resource read; busy, repeated, composing or extra-modifier events do not duplicate
the read. Outside the inspector the active Catalog/workspace handler owns the
shortcut, including overview/resource/custom lists. This is not a mutation shortcut.
Fetched-time timestamps are no longer rendered, but resource Age/Last seen and
other observed object timestamps remain meaningful. Optional Pod LIST/WATCH is
still opt-in, not full Freelens parity. The previously agent-verified reference is
local Freelens `cd07118f843c4a69f937a319a37a7c12ef2c92d8`,
`packages/core/src/common/k8s-api/kube-object.store.ts` (`subscribe` workflow),
not an upstream claim that polling and watches are equivalent.

Acceptance sources are `tests/auto-refresh.spec.ts` and the quiet automatic Pod
LIST/manual-continuation case in `tests/resource-tables.spec.ts`. See
[workspace UI reference](workspace-ui-reference.md) for the scheduler's precise
guards and source-to-test mapping. These are fixture obligations, not current
passing results or native/real-cluster verification.

## Kind-specific facts actually projected

All rows below refer to the named match arm in the exact Icekube source path `src-tauri/src/connection/detail_facts.rs`. All non-sensitive kinds may also receive `/status/conditions` type, status, reason and last-transition facts, never condition messages. Explicit scalar fields missing or rejected by sanitization become `Not reported`; array fields that are missing, invalid or empty may produce no section.

| Resource kind(s) | Supported facts | Important omissions / interpretation limits |
| --- | --- | --- |
| Nodes | OS, OS image, architecture, kernel, kubelet, container runtime, unschedulable; capacity and allocatable CPU/memory/pods/ephemeral storage; address type/address; taint key/value/effect | No machine identifiers or arbitrary metadata; generic Conditions can overlap the separate typed node presentation. |
| Pods | Node, service account, scheduler, priority class, restart policy, phase, Pod/host IP, QoS | No container payload, environment, mounts or templates in generic facts; actual Pod inspector uses its separate contract. |
| Deployments | Desired/current/ready/available replicas, observed generation; updated/unavailable replicas, strategy, max surge/unavailable, pause, progress deadline; selectors | No Pod template or revision history; expression values omitted. |
| DaemonSets | Desired/current/ready/available/unavailable/updated/misscheduled counts, update strategy; selectors | No Pod template, rollout subfields or expression values. |
| StatefulSets | Desired/current/ready/available replicas, observed generation; service, Pod management, update strategy, current/update revision, updated replicas; selectors | Shared replica fields may be absent in served objects; no claim templates or expression values. |
| ReplicaSets | Desired/current/ready/available replicas, observed generation; selectors | No templates or expression values. |
| ReplicationControllers | Desired/current/ready/available replicas, observed generation; flat selector | Shared fields unsupported by this API remain `Not reported`; no templates. |
| Jobs | Parallelism, completions/mode, backoff/deadline, suspended, active/succeeded/failed, start/completion times | No Pod/job template, environment or logs. |
| CronJobs | Schedule/time zone, concurrency, suspended, starting deadline, history limits, last schedule/success; active job name/namespace | No job template or execution history fetch. |
| Services | Type, cluster IP, external name, traffic policies, session affinity, IP-family policy; port/name/target/protocol/node port; cluster/external IPs and families; load-balancer IP/hostname; selector | No arbitrary annotations or load-balancer payload. |
| Endpoints | Subset count; first three subsets' ready IP/hostname/node, not-ready IP/hostname, port name/number/protocol | Target references omitted; subsets beyond three silently omitted (see coverage caveats). |
| EndpointSlices | Address type; port name/number/protocol; endpoint node/hostname and ready/serving/terminating; first six endpoints' address arrays | No target references/topology; address sections beyond six silently omitted. |
| Ingresses | Class, default service/name and numeric port; rule hosts; first four rules' path/type/service and numeric/named port; first four TLS entries' hosts | No TLS secret name, annotations, raw headers, certificates or arbitrary resource backends. Default backend named port is not projected. |
| IngressClasses | Controller; parameter API group, kind, name and scope | Parameter namespace/content omitted. |
| NetworkPolicies | Ingress/egress rule counts, policy types, Pod selector matchLabels | No peer CIDRs, ports, rule details or selector expressions; counts do not describe policy semantics. |
| PersistentVolumes | Phase, class, mode, access modes, capacity, reclaim policy, claim name/namespace, CSI driver | No volume sources, CSI attributes, credentials or secret references. |
| PersistentVolumeClaims | Phase, class, mode, requested/reported access modes, requested/reported storage, bound volume | No source payloads or credentials. |
| StorageClasses | Provisioner, reclaim policy, binding mode, expansion, allowed-topology count | No parameters, secret names or topology values. |
| Roles, ClusterRoles | Rule count; first eight rules' verbs, API groups, resources and resource names | Non-resource URLs and aggregation omitted; empty-string core API group currently disappears; multi-array truncation can hide facts without coverage. Not a complete effective-permission view. |
| RoleBindings, ClusterRoleBindings | Role reference API group/kind/name; subject kind/API group/name/namespace | Subject identities are intentionally exposed, not anonymized; no token/credential data. |
| ServiceAccounts | Automount-token setting; secret-reference and image-pull-secret-reference counts | No secret names, keys, tokens or values. |
| CustomResourceDefinitions | Group, scope, kind/plural, conversion strategy; version name/served/storage; stored versions | No schemas, conversion webhook client configuration, CA bundle, or custom resource instances. |
| Namespaces | Phase | No arbitrary metadata/finalizer payload. |
| Events | Detail sections: type, reason, count, first/last timestamp, reporting controller. Inventory columns also project message, source, series/count and validated occurrence times. | Message/source are bounded selected text, not raw events or guaranteed secret-free text; involved-object navigation is separately validated in `details.rs`. |
| ResourceQuotas | Hard and used CPU/memory requests/limits, pods, storage requests from status | Not all quota resource names; no spec fallback or scopes. |
| LimitRanges | Entry type; min/max/default/default-request CPU and memory | No other resource dimensions or ratios. |
| HorizontalPodAutoscalers | Target kind/name, min/max/current/desired replicas, last scale | No metrics, scaling behavior or recommendation history. |
| VerticalPodAutoscalers | Target kind/name, update mode; container name, target CPU/memory, lower/upper CPU | Lower/upper memory and policy details omitted. |
| PodDisruptionBudgets | Min/max availability, disruptions allowed, healthy/desired/expected counts; selector matchLabels | No selector expressions or disrupted-Pod map. |
| PriorityClasses | Priority value, global default, preemption policy | Description omitted. |
| RuntimeClasses | Handler, CPU/memory overhead | Scheduling selectors and tolerations omitted from detail facts. |
| Leases | Holder, duration, acquire/renew times, transitions | No election actions or ownership claim. |
| MutatingWebhookConfigurations, ValidatingWebhookConfigurations | Webhook count; name, failure/match policy, side effects, timeout, service name/namespace | No client URL/path, CA bundle, rule details, selectors, admission versions or CEL. |
| ValidatingAdmissionPolicies | Failure policy, parameter kind/API version, observed generation; validation/match-condition/resource-rule counts | No CEL expressions, messages, audit annotations or actual rule details. |
| ValidatingAdmissionPolicyBindings | Policy, parameter name/namespace/not-found action, validation actions | No parameter payload or matching rule details. |
| PodSecurityPolicies | Privileged, host network/PID/IPC, read-only root FS, run-as-user/SELinux/FS-group rules | Removed API remains unavailable when not served; no fallback or claim of full policy semantics. |
| ConfigMaps, Secrets | No sections; metadata-only inventory item and validated namespace navigation | No type, data, binaryData, stringData, data key names, labels, annotations or managed fields. Object name/UID/resourceVersion/namespace/timestamp remain identity metadata. |

No audited facts path projects environment variables, webhook CA bundles, ingress TLS secret names or raw headers. This is path-based withholding, not content-aware secret detection: selected names, selector values, taints, reasons, hosts, subject identities and policy resource names remain cluster-provided text and can themselves contain sensitive information. Do not describe these as universally non-sensitive.

## Bounds and honest coverage

- Rust permits at most 12 sections, 32 facts/section, and 1,024 UTF-8 bytes per string value. It rejects empty strings, control characters and bidi embedding/isolate controls. Selector labels additionally have a 128-byte bound. Numbers and booleans are converted to text; objects/arrays are not scalar fallbacks.
- Rust's final budget uses `(label bytes + value bytes) * 6 + 64` per fact, reserving 4,096 bytes of the 64 KiB budget. This conservatively covers JSON escaping, fact structure and the bounded generated section titles. It is **not** a measured 64 KiB cap on the whole ResourceDetail response: identity, inventory columns, related references and typed node data are separate.
- The renderer independently measures `TextEncoder(JSON.stringify(sections))` against 64 KiB, including section/fact JSON overhead. Its string lengths use JavaScript UTF-16 code units, not Rust UTF-8 byte lengths. It rejects C0/C1 controls but does not independently reject Rust's bidi ranges.
- `rows` samples at most 12 entries and marks row/fact truncation with `Coverage: Partial: display limit reached`. Its estimate can mark partial even if many fields are absent.
- **Known gaps:** `strings` gathers up to 12 values per field then `push` silently truncates the combined section to 32 facts. In a full RBAC rule this can lose resource names and even an appended coverage marker. Outer sampling of Endpoints (three subsets), EndpointSlices (six address groups), Ingress rules/TLS (four each), and RBAC rules (eight) has no explicit partial marker. Section-limit and total-budget drops are also silent. Thus the presence or absence of a coverage fact does not establish completeness.
- Empty-string RBAC API groups mean the core API group in Kubernetes, but `safe` currently rejects them. A displayed rule can therefore omit this meaningful group. No rule view should be interpreted as an exhaustive authorization result.

## Acceptance mapping

These are local test paths and test identifiers, not upstream parity evidence.
The current documentation pass inspected source only; final validation is pending.
See [workspace UI reference](workspace-ui-reference.md) for exact sidebar,
CodeJar, status, overview and CRD acceptance cases.

| Acceptance obligation | Existing evidence | Remaining gap |
| --- | --- | --- |
| Detail and cancel use the registered shared state | `src-tauri/src/lib.rs`: `command_state_tests::generic_details_extract_the_registered_shared_engine_type` | Source-level signature/registration regression only, not a real native Tauri invocation. |
| RBAC names survive validation, paths and inventory projection | `details/tests.rs`: `rbac_names_are_validated_per_kind_and_encoded_as_one_path_segment`, plus named-object fixture tests in that file | Synthetic names/fake services, not real-cluster authorization evidence. |
| Every allowlisted kind has an explicit projection and no raw metadata fallback | `src-tauri/src/connection/detail_facts/tests.rs`: `every_kind_has_explicit_safe_facts_or_sensitive_empty`; `src-tauri/src/connection/details/tests.rs`: `every_allowlisted_kind_has_consistent_named_endpoint_and_safe_projection` | Minimal fixtures do not assert every mapped field's value or upstream equivalence. |
| Representative resource-specific facts rather than repeated inventory columns | `detail_facts/tests.rs`: `kind_specific_values_are_not_generic_inventory_columns` (Node, DaemonSet, StatefulSet, Deployment, Service, Ingress, Role, CRD, PV) | Expand to remaining kinds and unsupported field states; verify actual renderer sections. |
| Metadata-only Secret/ConfigMap reads and output | `details/tests.rs`: `secret_and_configmap_contents_never_cross_projection`, `real_transport_uses_named_get_and_metadata_accept_on_fake_service` | Explicit transport assertion currently covers Secret; test ConfigMap and malicious key names as well. |
| No ingress TLS secret/PV credentials/condition messages in facts | `detail_facts/tests.rs`: representative kind test above and `node_condition_facts_never_contain_messages` | Add explicit environment, ingress-header and webhook/CRD CA-bundle sentinel fixtures. Absence was source-audited, not all regression-tested. |
| Bounded text and serialized sections | `detail_facts/tests.rs`: `values_and_collections_are_bounded_without_raw_serialization` | Add meaningful core API group, multi-array 32-fact truncation, nested sample and total-budget coverage assertions. |
| Exact identity, scope, UID and stale/cancel lifecycle | `details/tests.rs`: `exact_paths_and_closed_scope_validation`, `identity_and_response_type_are_verified_before_projection`, `cancel_is_lease_scoped_and_independent_from_table_reads`, `deadline_and_drop_release_workers_and_new_reads_survive_old_disposal` | No real-cluster/runtime assertion. |
| Related links cannot invent target scope or identity | `details/tests.rs`: `related_references_preserve_scopes_and_allowlisted_types`, `event_relations_require_exact_type_scope_and_uid`, `ingress_and_pod_explicit_relations_do_not_infer_defaults_or_annotations`, `workload_controllers_preserve_exact_namespaced_identity` | Upstream per-kind interaction comparison still pending. |
| Nonmodal inspector, identity rejection, stale refresh and disposal | `tests/resource-inspector.spec.ts`: per-view name-opening tests, `rejects … detail contract without exposing raw secrets`, `late old detail cannot overwrite the latest selection and each disposal cancels its own read`, `failed refresh marks retained metadata stale and recovery replaces it` | IPC mocks, not native/cluster proof; section-specific bounds tests are not established by these metadata tests. |
| Narrow/internal scrolling and themes | `tests/resource-inspector.spec.ts`: `inspector stays inside viewport with internal scrolling at …` | Browser fixture coverage only; not native OS verification. |

### Sidebar interaction and scope

`ResourceInspector.tsx` owns the layout sidebar, icon-only named Refresh details,
Expand inspector/Restore inspector width and Close inspector controls. A token
border separates it from the table; pointer capture and a keyboard separator
resize it without covering the workspace. Home/End reach bounds, arrows adjust
width, expansion uses 75%, and Restore retains the previous width. CSS transitions
are disabled for reduced motion and dragging. Close immediately unmounts content
and cancels reads; the collapsing shell is inert and hidden from accessibility.
Rust `connection/details.rs` retains ownership of scoped GET/cancellation;
Pods retain their separate `pods.rs` contract. Loading, retained-stale,
missing/replaced, permission/error and disconnected states must remain honest.

The compact header shows the plain resource name rather than a second descriptive
title. Pod details expose named Logs, Shell, Attach and Port forward icon actions
where applicable, alongside a single Refresh, Expand/Restore and Close. Header
controls stay outside the independently vertically scrolling body. Refresh keeps
same-object data with a stale notice if it fails. `PodDock.tsx`'s compact details
composition does not add a duplicate Refresh. Initial reads use `ContentLoading`'s
centered named Astryx spinner; retained reads use its nonblocking progress bar and
keep actionable errors. Browser acceptance remains in `tests/resource-inspector.spec.ts`,
`tests/inspector-resize.spec.ts` and `tests/loading-feedback.spec.ts`.
`tests/compact-inspector.spec.ts` also checks both Meta+R and Control+R with
inspector focus and asserts the resource list is not refreshed. `ContentError`
centers blocking detail failures; same-object failures with retained facts use a
compact stale error. Search/filter controls on surrounding data pages remain at
the top. `tests/centered-errors.spec.ts` covers this distinction on inventory pages.

`resources.rs` inventory event text is capped at 256 UTF-8 bytes after control and
bidi-character filtering. This does not detect credentials in messages or other
selected text. CRD inspector facts remain group/scope/versions, not schemas.
The separate [custom-resource metadata list](custom-resources.md) does not expose
custom-object details/edit/delete: its names are plain text, not dead links.
Cluster Overview Warning Events resolve related-object/namespace details through
Rust using validated Event identities and the existing inspector; no historical
Prometheus or fabricated metric detail is implied.
Native file-picker smoke tests and actual-cluster validation
have not been performed by this documentation pass. No real kubeconfig was read.
Latest full-suite validation for automatic refresh, navigation and prerelease changes is pending; older
counts in the workspace reference are historical, not current verification.
