# Iceon permission management and RBAC design

**Status:** proposed design, awaiting approval. No application code or Kubernetes permissions are changed by this document.

## 1. Objective and scope

Iceon should adapt its cluster navigation, resource views, details, and actions to the capabilities of the identity connected to Kubernetes. A person who can read Pods in one namespace should not see a UI suggesting they can manage Nodes, browse Secrets, or open a shell. An authorized administrator should also be able to inspect and deliberately manage Kubernetes roles and grants from Access Control.

There are two distinct workstreams:

1. **Permission-aware workspace:** discover the current identity's effective capabilities and consistently gate navigation, reads, actions, shortcuts, deep links, and background work.
2. **Permission administration:** inspect and manage Roles, ClusterRoles, RoleBindings, ClusterRoleBindings, and their subjects, using explicit review, server validation, confirmation, and conflict detection.

The first does not require the second. Ordinary users must not need to list RBAC policy objects, install a CRD, run a privileged in-cluster service, or hold administrator credentials just to use Iceon.

**Security boundary:** hidden controls are a usability feature, not authorization enforcement. Kubernetes authorizes the actual operation. Rust derives and checks the intended operation and preserves existing validation, identity preconditions, cancellation, secret handling, and server-error behavior. No renderer boolean or template name grants access.

### Interpretation of “models”

The proposed domain model comprises:

- **Subject:** User, Group, or namespaced ServiceAccount.
- **Role:** native Kubernetes Role or ClusterRole containing exact policy rules.
- **Binding:** RoleBinding or ClusterRoleBinding associating subjects with a role.
- **Capability:** a current, server-observed decision for an exact operation and scope.
- **Template/profile:** an optional grant preset referencing real policy objects, not a separate authority.

Labels such as Viewer, Developer, Operator, and Administrator are convenient preset names, not a fixed access hierarchy. Kubernetes grants are additive, can be composed, and do not contain RBAC deny rules. Other configured authorizers can affect the final result. Iceon will not infer privileges from a role name, kubeconfig user alias, email, context label, or `isAdmin` flag.

## 2. Reference project and research provenance

### Checked-out source

- Repository: [sighupio/permission-manager](https://github.com/sighupio/permission-manager).
- Local clone: `/Users/user1/Kerjaa/permission-manager`.
- Reviewed commit: **`fb6f65e161ac792ab290ffe680d6420caf834a43`**.
- Git description: **`v1.9.0-2-gfb6f65e`**.
- Commit date: **2023-05-08**. This is the inspected checkout, not a claim that its dependency/security posture is current.
- Root license: [BSD 3-Clause](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/LICENSE.md#L1-L29), copyright SIGHUP 2020.

The review used source and official Kubernetes documentation. The reference application was not built, installed, deployed, or executed. No real kubeconfig, token, credential helper, or cluster was used. No source code or manifests were copied into Iceon. If implementation later adapts upstream code/assets, retain required source/binary notices and review third-party provenance; the seed file also attributes some rules to a Lens contribution.

### What Permission Manager actually implements

| Observed workflow | Pinned source evidence | Iceon decision |
| --- | --- | --- |
| User creation, permission/namespace assignment, kubeconfig display | [README](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/README.md#L12-L14), [wizard](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/new-user-wizard.tsx#L79-L93) | Borrow the guided review flow; separate administration from current-user capability discovery. |
| Templates are prefixed ClusterRoles, not a template CRD | [README](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/README.md#L49-L78), [prefix constants](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/constants.tsx#L66-L70), [selection](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/TemplateSelect.tsx#L17-L61) | Optional compatibility discovery only. Inspect actual rules and role UID/version; a prefix is not ownership or authority. |
| Namespace/template pairs; separate cluster-resource choice | [template pairs](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/TemplatePairSelect.tsx#L15-L73), [cluster access](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/ClusterAccessRadio.tsx#L12-L44) | Keep namespace grant and cluster-wide grant visibly separate. |
| Selected namespaces create RoleBindings referencing ClusterRoles; “all namespaces” creates a ClusterRoleBinding | [binding construction](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/services/rolebindingCreateRequests.tsx#L114-L206), [RoleBinding](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/internal/resources/rolebinding.go#L17-L38), [ClusterRoleBinding](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/internal/resources/clusterrolebinding.go#L12-L26) | Review the real binding kind and effective scope. “All namespaces” must not silently mean an enumerated current namespace set or vice versa. |
| `operation` is wildcard access; `developer` includes Secrets and wildcard verbs | [seed rules](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/deployments/kubernetes/seeds/seed.yml#L1-L41) | Do not ship these as safe default profiles or infer permissions from their names. |
| Read/write summary checks literal `read` or `*`, and `create` or `*` | [rule summary](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/TemplateInfo.tsx#L30-L40) | Do not reuse this reduction: Kubernetes uses distinct get/list/watch/create/update/patch/delete verbs and subresources. |
| Shared Basic Auth administrator and a privileged server-side Kubernetes client | [middleware/client setup](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/internal/server/server.go#L30-L69), [deployment role/binding](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/deployments/kubernetes/deploy.yml#L47-L109) | Do not transplant its Go/HTTP/shared-admin architecture. The deployment binds a powerful custom `permission-manager` role, not literally the built-in `cluster-admin` role. |
| “Users” are Permissionmanageruser CRD records | [CRD](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/deployments/kubernetes/seeds/crd.yml#L5-L26), [creation](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/internal/resources/v1alpha1_permissionmanageruser.go#L51-L98) | Do not require this registry or present it as Kubernetes's universal human-user database. |
| Kubeconfig export creates/reuses a ServiceAccount and a long-lived token Secret, then returns its bearer token to React | [ServiceAccount/token/kubeconfig](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/internal/resources/serviceaccount.go#L27-L134), [modal/copy](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/CreateKubeconfigButton.tsx#L31-L111) | Do not copy. Credential issuance/export is a separately approved future workflow, never an inspection side effect. CSR permissions in deployment do not establish that this export issues client certificates. |
| Editing deletes and recreates name-matched bindings; legacy migration can start when its modal mounts | [ownership heuristic](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/services/role.tsx#L50-L79), [edit/delete flow](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/edit-user.tsx#L126-L159), [migration](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/web-client/src/components/edit-user.tsx#L279-L291) | Preserve unrelated subjects and unmanaged objects. Never mutate on navigation/open. Changes are non-atomic and need per-step results. Deleting a registry record is not proof of credential revocation. |

## 3. Iceon baseline and known gaps

Current integration points are `src-tauri/src/connection.rs`, `connection/transport.rs`, `connection/renewal.rs`, `connection/{pods,pod_runtime,pod_sync,create,delete,custom_resources}.rs`, `src/app/cluster/{ClusterSidebar,DestinationGrid,RowContextMenu,ResourceActions,ResourceInspector,PodDock,NamespaceScope,WorkspaceRefresh}.tsx`, and `src-tauri/src/context_menu.rs`.

Source observations, not future promises:

- Rust owns Kubernetes clients, credentials, operations, subprocesses, cancellation and persistence; React owns presentation and typed IPC.
- A successful `/version` probe means Connected, not authorization to read every resource.
- The present engine has a **single shared current session lease**. Additional native windows do not yet have isolated Kubernetes engines. This design must not accidentally turn that into shared cached permissions across identities.
- No self-access-review capability service is implemented. Current unavailable controls mostly reflect loading, safe resource identity and implementation support, not an authorization model.
- Resource mappings exist in Rust; new permission mappings should derive from the same registry rather than duplicate a frontend list of API paths.
- Credential renewal can replace an inner client without changing outer session strings. Its internal generation is not yet an authorization epoch.
- Pod details currently couple Pod GET with Events LIST. Logs/exec/forward currently depend on a detail response as well. A permission-aware implementation must decouple optional Events before advertising Pod-only access.
- Custom-instance lists currently require reading the UID-bound CRD before listing metadata. CRD discovery permission and custom-instance permission are separate.
- Helm uses a separate subprocess/configuration path. Do not certify chart installation from a chart-independent permission list or assume the shared client renewal service covers Helm credentials.

## 4. Authorization policy and invariants

1. Use the **current connected Kubernetes identity**. Do not create a second privileged client, fall back to a different context, or silently impersonate anyone.
2. Determine self-access primarily through `authorization.k8s.io/v1` **SelfSubjectAccessReview (SSAR)**. No Role/Binding list is required for ordinary navigation.
3. Use **SelfSubjectRulesReview (SSRR)** only for optional namespace-local summaries/hints. It can be incomplete and is not an enforcement oracle. Absence from a partial result is not denial.
4. Distinguish allowed, denied, checking, unknown and stale. Network errors, unavailable review APIs, evaluation errors, malformed replies and inability to create a review are not a denial of the requested target operation.
5. Verify the actual operation at the API server. A review is an advisory point-in-time observation, not a signed grant or admission approval. Permissions can change immediately after a successful check.
6. All supported engine commands apply the same Rust action policy. Row menus, keyboard shortcuts, routes and renderer IPC cannot bypass it.
7. Never broaden a namespaced grant into all-namespaces or cluster-wide access. Never equate collection LIST with named GET.
8. Keep cleanup available: Stop forward, Close stream/tab, Cancel operation, Disconnect and window/application shutdown do not require a new access grant.
9. Do not grant wildcard authority, `bind`, `escalate`, `impersonate`, token creation or CSR approval automatically to make a feature work.
10. Data minimization remains: metadata-only rendering of Secrets or custom objects still requires permissions on the underlying resource. It is not a lesser Kubernetes privilege.

### Decision evaluation

For a well-formed matching SSAR response:

- `allowed=true`, `denied!=true`, no evaluation error: **allowed**.
- `allowed=false`, no evaluation error: **denied**, whether `denied` is true or false. Both false can represent a completed no-allow verdict.
- Conflicting allowed/denied values, missing/malformed status, truncated response, or nonempty `evaluationError`: **unknown**, never a fabricated allow. A conservative unknown here can conceal a potentially usable action but must explain review failure, not label the user denied.
- A request to the *review endpoint* receiving 401/403 is an authentication/review failure, not evidence that Pods or Nodes are denied.

Keep authorizer reasons/evaluation messages inside Rust unless deliberately sanitized and capped. Return stable codes and safe UI text, not raw webhook/server errors.

## 5. Proposed Rust engine and typed contract

All names and limits in this section are **proposed**, not existing APIs.

### Ownership

Add `connection/permissions.rs` and a `PermissionSession` owned by the existing Rust session. Put API mappings and action requirements in `connection/permission_registry.rs`; reuse fixed resource descriptors, validated CRD descriptors and the exact transport operation.

Each authorization scope has an opaque `authorizationEpoch` that changes on:

- session open/replacement/reconnect/disconnect;
- successful credential replacement, including rotation under the same outer client;
- source/context/authentication configuration change;
- explicit permission refresh; and
- confirmed relevant permission invalidation/revocation handling.

Capture a lease-owned scope before async work and revalidate it before publishing results or dispatching dependent work. A dedicated scope object may use pointer identity internally, but an outer `kube::Client` pointer or session strings alone are insufficient. `capture_scope()` and `client_api()` would be new boundaries; they do not exist today.

Do not hold a session/cache mutex over network or subprocess awaits. Cancelling one view's review subscription must not abort a deduplicated review still needed by another current consumer. Disconnect/shutdown cancels the owner and all subscriptions. Multiwindow isolation must be settled before enabling concurrent, independently authenticated workspace leases.

### Capability keys

Use a closed union, with API version retained for endpoint/availability checks:

```text
ResourceCapability {
  clusterId, sessionId, authorizationEpoch,
  apiGroup, apiVersion, resource, subresource?, verb,
  scope: Cluster | AllNamespaces | Namespace(name),
  resourceName?
}
NonResourceCapability {
  clusterId, sessionId, authorizationEpoch, verb, path
}
```

The core group is the empty string `""`, not a missing/unknown group. `resource` is the actual plural, not a UI label; `pods/log` is represented as resource `pods`, subresource `log` in an SSAR. Known names can be essential for `resourceNames`-restricted grants. A future name-selected LIST/WATCH must include the corresponding field selector; the present unqualified list must not claim that access.

### Proposed IPC

- `cluster_permissions_review`: closed batch of **implemented action descriptors**, not arbitrary URLs, identities, headers, user/group overrides or allow bits. Rust derives the capability requirements.
- `cluster_permissions_cancel`: exact cluster/session/read owner and matching batch fingerprint; monotonic read IDs, cancellation-before-registration and stale completion rejection.
- `cluster_permissions_refresh`: invalidate the current epoch/cache and schedule the active scope's bounded reviews.

A reply contains cluster/session/read IDs, authorization epoch, capability revision, per-action requirements and decisions, checked/expiry times, and partial coverage. Results for unrelated actions, namespaces, epochs or sessions fail validation. Review availability, API availability and local tool availability are separate fields, not folded into “denied.”

Illustrative action result:

```text
{
  action: pod.logs,
  target: { namespace: team-a, name: api-pod },
  decision: allowed | denied | checking | unknown | stale,
  requirements: [get core/pods/api-pod, get core/pods/api-pod/log],
  reasonCode: reviewDenied | reviewUnavailable | reviewFailed | expired | ...,
  capabilityRevision, checkedAt, expiresAt
}
```

This is a contract sketch, not executable code or an approved schema migration.

### Bounds and cache policy

Initial proposed defaults, to be fixture-tested and tuned before approval:

| Budget | Proposal |
| --- | --- |
| Client batch | At most 32 action descriptors; expanded review work is separately capped, deduplicated and returned partial if necessary |
| Network concurrency | At most 2 authorization reviews, sharing the existing 4-operation global admission budget; reserve ordinary reads/cleanup from startup storms |
| Deadline/body | 5 seconds per review, 10 seconds per batch, 64 KiB per review response; bounded total batch result at 256 KiB |
| Cache | Memory-only LRU, at most 1,024 exact keys per active authorization scope; no credentials or persisted grants |
| UI freshness | Allowed observations at most 30 seconds, denied at most 10 seconds; transport/review failure is unknown and uses bounded retry, not a cached deny |
| Retry | Deduplicated bounded transient backoff, maximum 60 seconds; focus does not create overlapping refreshes |

Lazy-load named/action reviews for visible rows, open menus and selected items rather than checking every verb on every object. Startup prioritizes navigation reads for the current known namespace, then visible page dependencies. Preserve disclosure position/focus as async leaves become available; never flash all administrator controls while checking.

Before enabling a sensitive action, refresh stale checks. Recheck mutation requirements at confirmation/submission and before each batch item. Server admission, UID/resourceVersion checks, schema validation and dry-run remain mandatory. Unknown mutation requirements block submission with an explanation/retry. When self-review is unavailable, an explicitly requested **read-only** view may attempt the actual bounded operation in an “access unverified” state; actual 403 then marks only that exact operation denied. Do not prefetch all unknown pages or implement a silent mutation fallback.

The renewal wrapper currently does not automatically replay POST requests, including SSAR. Integrate current-credential acquisition and epoch invalidation before review dispatch. Any explicit single retry of a non-persisted self-review after renewal requires its own bounded test and must not generalize to replaying ordinary POST mutations.

## 6. Exact workflow requirements

The table describes current engine dependencies and the intended permission-aware behavior. It is not a promise that all decoupling already exists.

| User workflow | Kubernetes requirements / notes |
| --- | --- |
| Connect | GET non-resource `/version`; connection does not imply any inventory grant. |
| Browse a fixed resource list | `list` exact group/resource and selected namespace or AllNamespaces. No global `get` requirement just to list. |
| Open resource details or related reference | Exact named `get` of target; LIST does not imply GET. Secret/ConfigMap metadata uses the same resource privilege as full GET. |
| Create resource or server dry-run | `create` target resource, exact namespace. Dry-run is not read-only authorization. Admission can still reject it. |
| Delete selected resources | Current implementation first performs named `get`, then individual `delete`, with UID/version preconditions. Do not check `deletecollection`. Review every target scope, not just the first selected row. |
| Edit Pod YAML | Named `get pods` + `update pods`, because current transport uses PUT. Patch permission alone is insufficient. |
| Pod Delete / Force delete | Named `get pods` + `delete pods`. Grace period zero is a dangerous option, not another RBAC verb. |
| Remove Pod finalizers | Named `get pods` + `patch pods`. Current code patches the Pod metadata; do not invent a `pods/finalizers` or `/finalize` endpoint. |
| Logs / previous / follow | `get pods` for existing identity/container validation + named `get pods/log`. Following logs is not `watch pods/log`. |
| Shell / Attach | Pod identity read plus permission for the actual upgraded exec/attach method. Current code calls kube's exec/attach APIs; use `get pods/exec` or `get pods/attach` only once wire-level fixtures confirm the GET-upgrade request. A POST implementation would require `create` instead. Do not require both speculatively or try alternative methods to bypass a deny. |
| Start port forward | Pod identity read plus the transport's verified `pods/portforward` permission, with the same GET-versus-POST qualification. Local loopback and port bounds remain. |
| Stop/remove a local forward; close logs/shell | Local owner cleanup, available after permission loss, independent of a new API grant. Starting/restarting is different. |
| Pod live sync | `list pods` + `watch pods`. If watch is denied but list allowed, keep the list usable; offer snapshot/poll mode with honest state. |
| Pod details Events | Current response couples `get pods` + namespace `list events`. Proposed response separates optional Events into denied/unavailable/partial section state so Events denial cannot prevent an otherwise permitted Pod/log action. |
| Node utilization | Core `list nodes` and separate `list nodes` in `metrics.k8s.io`. Metrics denial does not erase permitted inventory or invent zero usage. |
| Cluster/workload overview | Evaluate Nodes/workload inventories, metrics, Events and related links independently. Show available sections and clearly bounded counts; do not turn one denial into an empty whole page. |
| Namespace picker | `list namespaces` if allowed. Otherwise permit a validated known namespace entered manually or supplied as the saved context's explicit namespace. Do not guess `default` or infer a complete namespace directory. |
| Custom-resource discovery | `list customresourcedefinitions` in `apiextensions.k8s.io`; this does not authorize any custom instances. |
| Custom-resource metadata list | Current engine also requires named `get customresourcedefinitions` for UID/served-version verification, plus `list` exact custom group/plural/namespace. Metadata-only negotiation does not reduce authorization. If CRD GET/LIST is unavailable, show this existing dependency honestly; broader API-discovery fallback requires a separate endpoint design. |
| Helm chart search | Local Helm/repository capability, not a Kubernetes role decision. Keep its tool availability independent. |
| Helm releases | Driver/credential/scope dependent. Display actual results and denials; a guessed `list secrets` check cannot certify all deployments. |
| Helm install | Chart resources, hooks, namespaces, release storage and admission are content-dependent. No single SSAR can prove install permission. Later preflight must parse/render through Rust safely and report partial coverage, then preserve existing explicit dry-run/confirmation and actual server authority. |
| RBAC policy browser | Independent list/get permissions for Roles, ClusterRoles and bindings. Reading these is not a prerequisite for every other page. |
| Role/binding changes | Target CRUD permission plus server-enforced escalation/binding restrictions; see section 9. No local “administrator mode” bypass. |

## 7. Navigation and action behavior

### Common state rules

| State | Navigation | Actions / data |
| --- | --- | --- |
| Checking | Stable pending navigation model; do not mount protected page effects yet | No speculative mutation controls; accessible checking feedback |
| Fresh allowed | Show supported route/card/search destination | Show applicable controls, still subject to resource state, tool availability and confirmation |
| Fresh denied | Hide leaf from default cluster navigation, grids and scoped search; optional Access summary explains unavailable areas | Hide unavailable operational actions; direct route gives a centered permission explanation, never an empty resource list |
| Unknown | Never label as denied. Keep a limited capability-error/retry surface and explicit access-unverified read entry where supported | Disable mutation submission; no automatic forbidden-read storm |
| Stale | Do not treat cached allow as current; refresh the relevant scope | Block new sensitive work until reviewed; retained authorized data follows revocation policy below |
| API/tool unavailable | Separate from authorization denial | Explain unsupported API/absent Helm; do not request broader rights as a workaround |

Default behavior follows the user's request: **known-denied leaves and actions are hidden**. Add an optional “Show unavailable features” view in Access summary if approved, with accessible reasons and no executable denied controls. Do not require this preference for safe behavior.

### One model for every entry point

The same Rust-derived capability/action model must drive:

- inner sidebar leaves, parent destination cards, dynamic CRD groups and scoped command-palette results;
- table Create/Delete, selection and mixed-namespace bulk actions;
- name/related links, inspector buttons, YAML save, Pod dock actions and restart actions;
- visible dots menu, right click, keyboard ContextMenu/Shift+F10, and native menu selections;
- Cmd/Ctrl+R, saved route restoration, history, deep links and cluster switching; and
- auto-refresh, namespace discovery, metrics requests and optional watchers.

A parent remains visible when an accessible child or its own accessible workflow exists. An overview can be visible with only some sections; do not hide Workloads because Deployments are denied if Pods are readable. Keep non-cluster Catalog, Preferences, Help, connection recovery and cleanup reachable.

A hidden route must not start a read/watch simply because its component mounted. A valid old URL that is now denied shows a centered permission state and an accessible fallback, not a redirect loop or a silent change to another cluster. Restored routes run through current permission checks before resource effects.

Named-only access is an exception to menu completeness: denied collection access does not prove the user cannot inspect a known object. An explicit typed reference/deep link can review and GET that exact object without exposing an unauthorized inventory.

### Namespace scope

- Separate `Cluster`, `AllNamespaces`, and `Namespace(name)` in contracts and UI.
- Omitted namespace on a namespaced SSAR means all namespaces, not “any one namespace is allowed.” Never derive it by OR-ing known namespace grants.
- If all-namespaces LIST is denied, retain namespace-local views using a known allowed namespace.
- If namespace discovery is denied, a manual validated namespace flow remains available. Being able to list namespaces is neither proof nor a prerequisite for listing their Pods.
- Do not automatically enumerate arbitrary namespace guesses, service account bindings or policy objects to discover hidden namespaces.
- When namespace changes, invalidate old scope actions immediately and cancel stale reviews/reads. Never reuse a permission result from the previous namespace.

### Revocation and open operations

When relevant authorization changes or an actual operation returns permission denied:

1. Invalidate only the affected scope/action and mark its reviews stale; refresh within bounds.
2. Invalidate open native/renderer menus and pending confirmations using capability revision and epoch.
3. Prevent queued batch items from being submitted after invalidation; preserve known submitted outcomes.
4. Stop affected list/watch refresh work. Keep allowed sibling sections alive.
5. Remove sensitive rendered payloads on confirmed read revocation and show a permission state; do not indefinitely retain forbidden Secret-related, YAML, log or detail data under a stale badge. Data already seen or exported cannot be recalled.
6. On observed revocation of stream permission, cancel the affected owned stream/forward and retain safe end-state feedback and local cleanup controls. Do not promise instantaneous revocation of an already-open Kubernetes upgraded connection: policy changes may not terminate it and client-side checking has bounded delay.
7. A 401 triggers authentication/renewal handling; a 403 is not “cluster disconnected.” Namespace/scope policy refresh does not require reconnecting every time.

## 8. Illustrative access profiles

These examples describe expected *evaluated* behavior, not roles automatically installed by Iceon.

| Example | Sidebar / data | Actions |
| --- | --- | --- |
| Namespace reader, `team-a` only | Workloads and other explicitly readable resources in `team-a`; no Nodes unless separately granted. Namespace entry can be manual. | Details only where named GET is allowed; no create/delete/exec/forward by implication. |
| Pod troubleshooter | Pods for allowed namespaces, independent Events/metrics visibility. | Logs, exec, attach and forwarding are each independent grants, never one “write” checkbox. |
| Workload maintainer | Allowed workloads/config resources in named namespaces; no automatic Secrets or RBAC visibility. | Exact create/update/patch/delete controls as observed; list permission alone grants none. |
| RBAC grant manager | Access Control objects permitted at chosen scope. | Role/subject changes depend on CRUD, actual role rules and bind/escalate restrictions, not the profile label. |
| Cluster administrator | All supported capabilities that the API server actually allows. | Still subject to confirmation, implementation support, admission, resource identity and safe output. |

Present these as optional least-privilege starting points during future grant design. Show exact rules before applying; do not silently bind built-in `cluster-admin` or copy the upstream wildcard `operation` seed.

## 9. Full RBAC administration workstream

### Proposed Access Control pages

Extend the existing Access Control category, not the application shell:

- **My access:** current capability summary, selected namespace, coverage, expiry and refresh errors.
- **Roles / ClusterRoles:** exact rules, scopes, named-resource restrictions, aggregation and binding references visible to this identity.
- **RoleBindings / ClusterRoleBindings:** subjects, roleRef, scope, UID/resourceVersion and management provenance.
- **Subjects:** a bounded index derived only from bindings and ServiceAccounts the operator may read. Human User/Group subjects are strings supplied by authenticators; Kubernetes has no universal human-user CRUD directory. Absence from a partial index is not proof that a person/group does not exist or has no access.
- **Templates:** optional discovered references or local non-secret draft presets. No upstream CRD installation, seed application or shared administrator service is required.

Only surface pages whose own reads or supported administration tasks are available. The ability to inspect someone else's bindings is not proof of their complete effective access. Any future SubjectAccessReview preview for another subject requires explicit operator authorization and must label the tested subject/groups and coverage. Do not enable broad impersonation or collect user credentials to simulate them.

### Inspect exact policy semantics

Display core API group as “core,” while preserving `""` in the contract. Show API groups, plural resources/subresources, each verb, `resourceNames`, non-resource URLs, Role namespace, binding namespace, roleRef kind/name, and subjects with ServiceAccount namespace.

Support wildcard and aggregate-rule inspection with warnings. Aggregated ClusterRoles have controller-generated rules; do not edit their generated rules as if they were normal policy. Show selector contributions and incomplete visibility honestly. System/bootstrap/default roles need extra warnings; do not disable API-server reconciliation automatically.

### Plan -> validate -> confirm -> execute -> reconcile

All mutation orchestration belongs in Rust, behind separately approved APIs:

1. **Read baseline:** exact named object UID/resourceVersion, referenced role, and full subject set. Keep protected metadata/admission constraints.
2. **Build immutable plan:** exact additions/removals, role/binding identities, namespace versus cluster scope, dependencies, permission requirements and affected subjects. Bind an expiring plan ID/digest to the lease/epoch/baseline; renderer cannot swap a reviewed object before execution.
3. **Review permissions:** CRUD plus actual role-grant semantics. `bind` and `escalate` are not universally mandatory: Kubernetes can permit a change when the caller already holds all permissions involved. Conversely, `create rolebindings` alone does not guarantee the grant is legal. Use server dry-run on the exact intended object; do not declare escalation legality from a local union of visible roles or from a single CRUD SSAR.
4. **Validate safely:** schema validation and bounded server dry-run. No hidden “create user,” credential issuance, CSR approval, wildcard seeding or automatic legacy migration on inspection.
5. **Confirm:** show cluster/context, scope, subject diff, role/rule diff, wildcard/privilege warnings, possible lockout, and non-atomic operation order. Changing `roleRef` requires replacement, not an ordinary patch; preview delete/create, temporary grant/revoke windows and recovery constraints explicitly.
6. **Execute:** require a current epoch and re-read baseline before each operation. Subject-only edits patch/update the exact binding, preserving unrelated subjects and fields. Deletes use UID/resourceVersion preconditions. Never delete every binding matching a username prefix.
7. **Reconcile:** record per-step accepted/failed/conflicted/not-submitted outcomes; reload affected objects and invalidate permission cache. A failed later step does not roll back earlier successful grants. Cancellation stops future submissions, not server effects already sent. Do not auto-replay mutations after auth/network failure or assume a compensation plan is safe.

No distributed atomicity is claimed. Deleting one binding does not revoke grants through other bindings/groups. Deleting a ServiceAccount can affect its workload credentials; deleting an external User subject string is not deleting an IdP account. Warn if an operator may remove their own management access; a preflight allow cannot guarantee recovery after a policy change.

### Credential issuance and export

This design does **not** implement credential provisioning. Prefer the user's existing organizational identity/OIDC/cloud login workflows. A future explicitly approved ServiceAccount token workflow should use TokenRequest with a requested duration/audience, display the actual expiry, explain binding/revocation behavior, and check `create serviceaccounts/token` plus its exact dependencies. Requested expiry is not guaranteed expiry.

Do not copy upstream's long-lived token-Secret creation, send token values in normal renderer events/logs/analytics, or show kubeconfig in a generic inspector. Any future native file export needs an explicit save operation, restricted file permissions, replacement/symlink policy, cancellation and secret-safe error paths. Clipboard/display issuance is a separate threat-model decision. No automatic TokenRequest or CSR approval is approved by opening this document.

### Optional upstream interoperability

If approved later, recognize the upstream prefixes and `Permissionmanageruser` records read-only when already installed. Show their provenance and actual native bindings; label the CRD as that application's registry, not the cluster's complete user directory. Never migrate, overwrite, delete or claim ownership by prefix alone. Mutating interoperability needs a distinct plan, object UID/version checks, preservation of unrelated subjects, explicit user confirmation and retained licensing notices.

## 10. Proposed module ownership

| Proposed owner / existing integration | Responsibility |
| --- | --- |
| `connection/permissions.rs` | Session/epoch ownership, bounded SSAR requests, normalization, deduplication, cancellation and cache |
| `connection/permission_registry.rs` | Exact requirements derived from resource/action transport descriptors; verified GET/POST subresource mappings |
| `connection/renewal.rs` | Publish credential-generation invalidation before dependent authorization results can be reused |
| `connection/rbac.rs` | Future safe RBAC reads, exact policy DTOs, immutable change plans, dry-run/confirmed execution and reconciliation |
| `lib.rs` | Thin typed Tauri commands using the registered shared engine state; no arbitrary endpoint/identity input |
| `PermissionProvider` / typed adapters under `src/app/cluster/` | Proposed ephemeral capability view, epoch validation and component subscriptions; no credential storage or cluster client |
| `navigation.ts`, `ClusterSidebar`, `DestinationGrid`, `AppSearch` | One permission-filtered presentation model with stable pending/denied/unknown handling |
| `ResourceActions`, `RowContextMenu`, native `context_menu.rs`, `PodDock` | Exact action availability and last-moment handler validation; retain cleanup |
| `ResourceInspector`, overviews, namespace/custom-resource providers | Section-local reads/links with independent permission states, no forbidden prefetch or fake empty state |
| Preferences/Catalog storage | Non-secret presentation preferences only if needed; no persisted “allowed” decisions, admin booleans or bearer credentials |

No Go service, Node backend/sidecar, renderer Kubernetes library, broad Tauri capability, permissive opener, or shell authorization subprocess is proposed.

## 11. Delivery phases and approval gates

| Phase | Deliverable | Exit criteria |
| --- | --- | --- |
| 0, current task | Pinned upstream audit and this design | Review authority, namespace behavior, unknown-state policy and administration scope. No application behavior change. |
| 1 | Rust SSAR/epoch/cache service and exact action registry | Wire-level subresource method tests; stale/renewal/cancellation tests; fixed budgets; no startup storm. |
| 2 | Permission-aware navigation, routes, namespace fallback and all implemented read/action entry points | Known-denied hidden consistently; unknown not mislabeled; exact backend guards; partial overview/details; no denied background reads. |
| 3 | Read-only policy/subject inspection and optional templates | Safe bounded complete/partial views, no privileged service/CRD requirement, no inferred universal user directory. |
| 4 | Separately approved Role/Binding administration | Exact dry-run, plan digest, confirmation, conflict protection, subject preservation, bind/escalate handling and partial-result recovery. |
| 5 | Optional interoperability or credential lifecycle | Separate threat model/approval, upstream ownership/provenance checks and no long-lived token default. |

Recommended first implementation, **after design approval**: phases 1–2 for fixed resources and namespace fallback; then read-only Access Control. Full management is the destination, but token issuance, impersonation and automated migration are not prerequisites or implicit permissions.

## 12. Acceptance-test design

Use existing mocked IPC/transport and synthetic credentials only. Every test below is proposed; none was executed as RBAC implementation evidence in this task.

### Authorization engine

- Allowed, explicit denied and completed false/false review states; conflicting flags/evaluation error/malformed/truncated response => unknown.
- Review endpoint 401/403/404/timeout versus target operation 403 remain distinct.
- Two namespaces and all-namespaces scope never share cache entries; core group `""` remains exact.
- ResourceNames-aware named GET works even when unqualified collection access is denied.
- Cache TTL/size/concurrency limits, shared worker admission, single-flight subscribers and deterministic partial coverage.
- Same cluster reopened, another cluster selected, cancellation before registration and late review publication.
- Inner credential renewal under an unchanged outer lease invalidates cached allowed decisions before reuse.
- POST self-review failure never causes ordinary mutation replay; no token/header/raw webhook errors reach IPC.

### Workspace and actions

- Namespace reader sees permitted Workloads children but not Nodes/Secrets/RBAC unless separately allowed.
- `list pods` allowed / `get pods` denied: list stays, details/actions do not falsely assume access.
- `create` allowed / `list` denied: supported explicit creation can remain reachable through Access summary without inventing inventory access.
- Namespace LIST denied but known namespace Pods allowed; all-namespaces denied but namespace-local allowed.
- Pod GET allowed / Events LIST denied: partial Events, usable Pod details/logs where separately allowed.
- Pod LIST allowed / WATCH denied: snapshot view usable; no watch retry storm.
- Exec/attach/forward capture actual method/path attributes; logs use `get`; Save YAML uses `update`; finalize uses `patch` on Pod metadata.
- Metadata-only Secret/custom view still checks underlying resource; CRD discovery, CRD GET and instance LIST are separate requirements.
- CPU metrics denied while Nodes inventory allowed: rows remain and metrics are unavailable, not zero.
- Mouse, right-click, Shift+F10, native callback, inspector link, command palette, shortcut, restore and deep link consume the same capability revision.
- Revocation while a menu/confirmation/batch/stream is open blocks new work, preserves prior outcomes, clears revoked sensitive data and leaves cleanup available.
- Permission uncertainty does not disconnect the cluster, expose all controls, erase permitted siblings, or render forbidden inventories as empty.
- Browser preview never fabricates permissions or contacts a cluster.

### RBAC administration

- Role versus ClusterRole and RoleBinding versus ClusterRoleBinding scopes; cross-namespace Role reference rejected.
- User/Group strings versus ServiceAccount namespace; existing subject set preserved on edit.
- CRUD allowed but bind/escalate restriction/admission rejects intended policy: dry-run error, no mutation.
- Explicit bind/escalate absent but exact grant legal under held permissions: do not wrongly require special verbs unconditionally.
- Immutable roleRef replacement, stale UID/resourceVersion, aggregated role, system/default role and self-lockout warnings.
- Partial grant/revoke plan, cancellation after a submitted operation, timeout with uncertain outcome and no automatic rollback/replay.
- Named-template collision, shared binding with extra subjects, incomplete subject directory and deleting one of several grants.
- Opening a view, template preview or legacy registry record makes **zero mutations**.

Likely suites to extend: `tests/{cluster-navigation,namespace-selector,resource-create,resource-delete,row-context-menu,native-context-menu,resource-inspector,pod-workspace,custom-resources,workspace-overview,workloads-overview,route-restoration,toolbar-cluster-switch}.spec.ts` and Rust `connection/{lifecycle_tests,renewal_tests,pod_sync_tests,pod_runtime_tests,create_tests,delete_tests,custom_resources/tests}.rs`. Use synthetic fixtures, not real kubeconfigs or auth plugins.

## 13. Decisions for review before implementation

Proposed defaults, rather than requests to implement now:

1. Kubernetes self-access results are authoritative for UI capability observations; templates are presets only.
2. Hide fresh known-denied entries/actions; provide clear pending/unknown/expired states instead of pretending denial.
3. Provide manual known-namespace selection and an explicit namespace scope before hiding namespaced features.
4. Keep My access available without RBAC policy-list permission; administration appears only where its own requirements allow.
5. Require fresh review plus current confirmation for mutations; explicit read-only access-unverified fallback only when self-review is unavailable.
6. No new privileged deployment, user CRD, long-lived token issuance, impersonation, or auto-migration as a prerequisite.
7. Preserve current single-lease ownership until independently scoped multiwindow connections are separately designed and tested.
8. Treat numeric budgets in this document as initial design targets, not benchmarked guarantees.

**Implementation is intentionally deferred until this design is approved.**

## 14. Kubernetes references and verification limits

Authoritative documentation reviewed alongside the pinned upstream source:

- [Authorization: request attributes, verb mapping and self-access checks](https://kubernetes.io/docs/reference/access-authn-authz/authorization/).
- [RBAC: additive rules, scope, resourceNames, immutable roleRef, bind/escalate and aggregate roles](https://kubernetes.io/docs/reference/access-authn-authz/rbac/).
- [SelfSubjectAccessReview v1](https://kubernetes.io/docs/reference/kubernetes-api/authorization-resources/self-subject-access-review-v1/).
- [SelfSubjectRulesReview v1](https://kubernetes.io/docs/reference/kubernetes-api/authorization-resources/self-subject-rules-review-v1/), including its incomplete-results/enforcement warning.
- [Authenticating: normal users, ServiceAccounts and server-established identity](https://kubernetes.io/docs/reference/access-authn-authz/authentication/).
- [Managing ServiceAccounts: TokenRequest and long-lived Secret token considerations](https://kubernetes.io/docs/reference/access-authn-authz/service-accounts-admin/).

These documentation URLs are moving references and may describe newer features than a connected cluster supports. Negotiate actual API availability and validate baseline behavior against supported server versions. The inspected Permission Manager revision is pinned; it is a behavior/reference source, not a drop-in security dependency.

This deliverable consists of the reference clone and this design file. It does not claim executed authorization tests, native UI validation, full upstream parity, a new release, or any change to current live-cluster permissions. Existing unrelated authentication-helper work in the Iceon working tree is preserved, not part of this RBAC design implementation.
