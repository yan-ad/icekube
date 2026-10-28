# Permission management in 0.0.2

**Status: approved scope, implementation in progress.** These are the intended
workflow and safety contract, with source owners and acceptance criteria. They
are not a claim of completed release validation, a published installer or tested
live-cluster behavior. The [original RBAC design](permission-manager.md) retains
research, broader future phases and Kubernetes references.

## Approach and boundary

Use the connected Kubernetes identity for self-access checks and management.
Rust owns authorization observations, clients, exact operation validation and
mutation plans. React presents typed results inside the existing Astryx cluster
workspace. There is no privileged Permission Manager service, Node backend,
renderer Kubernetes client or alternate administrator identity.

Kubernetes authorizes every actual request. Hiding a menu does not enforce
security; an allow review does not guarantee admission or future access. Reviews
are scoped to the session, authorization epoch, namespace or cluster scope,
resource, verb and named target where relevant. Namespace-local access never
implies all-namespaces access. A successful connection is not a permission grant.

## Access-aware workspace

- Known denied destinations and actions are hidden in the supported scoped
  navigation and action paths. Direct entry must show a permission explanation,
  not fabricate an empty inventory.
- **Read-only** requires server-known allowed reads and known denied relevant
  writes. A role name, template label, successful LIST or missing write result
  cannot establish it.
- **Access unverified** describes unknown or unavailable review results. It is
  not Read-only or Access denied. Explicit bounded read-only fallback may let
  Kubernetes decide the actual read; unknown mutation permission blocks changes.
- Checking and stale results do not enable a new mutation. Cluster/session,
  namespace and authentication changes invalidate older work and confirmations.
- Namespace discovery can fail independently of namespace resource access. Enter
  an existing known namespace when discovery is denied; do not guess or create it.
- Row, context and native menus must retain the exact target and permission
  scope. Cleanup, disconnect and cancellation remain available after access loss.

This release scope does not certify every helper or workspace module as fully
permission-aware. Helm's subprocess authorization, chart-dependent install
requirements, optional overview reads and arbitrary custom-resource dependencies
must not be described as covered by one generic allow bit. Keep their real
server errors and partial/unavailable states visible.

## Access Control > Users

Users means **managed Kubernetes ServiceAccounts and their saved assignments**,
not a universal User directory or normal human/IdP user CRUD. An observed-subject
index can remain useful separately, but is not a substitute for this workflow.

1. **Choose a user namespace.** Select an existing namespace or enter a validated
   known name. User/template management reads wait for this explicit selection
   and their own verified permissions. The namespace picker may independently
   request namespace discovery.
2. **Create New User.** Enter a ServiceAccount name. Rust creates the managed
   account in that namespace with `automountServiceAccountToken=false`. No
   namespace, template role, User CRD or credential is automatically provisioned.
3. **Assign namespaced resources.** Choose existing ClusterRoles with the prefix
   `template-namespaced-resources___`. Pair each template with explicit
   namespaces or an explicit all-namespaces choice. Selected namespaces produce
   RoleBindings referencing the ClusterRole; all namespaces uses a
   ClusterRoleBinding and must be reviewed as a broader grant, including future
   namespaces where the referenced rules apply.
4. **Choose cluster resources separately.** None, Read Only and Read Write map
   to the stored `none`/`read`/`write` selection. Read/Write require an existing
   `template-cluster-resources___` ClusterRole. Read offers conservatively
   read-only templates; Write does not invent permissions or add wildcard rules.
   None means no cluster assignment from this managed set, not proof that the
   account has no other access.
5. **Inspect exact rules.** Show API groups (including core), resources and
   subresources, verbs, `resourceNames`, non-resource URLs and scope. A summary
   is actual policy, not fake Read/Write booleans or a full effective-access
   calculation. Wildcards require explicit warnings. Template names/prefixes
   confer neither ownership nor safety.
6. **Review changes.** Rust reads current baselines, validates ownership and
   permissions, constructs exact steps and submits server dry-run requests.
   Dry-run uses mutation authorization and server bind/escalate/admission checks;
   CRUD permission alone does not establish that granting a role is legal.
7. **Confirm apply.** Review the subject, namespace/cluster scope, actual rules,
   warnings and ordered operations. Confirmation submits only that stored plan.
   Editing the draft requires another review; opening Users or previewing a
   template performs no mutation.
8. **Edit or delete.** Existing managed users reopen their assignments. Changes
   and deletion use the same review/dry-run/confirmation path, not immediate
   destructive row actions. Deletion affects the managed ServiceAccount and
   verified managed bindings only. External grants and identity-provider accounts
   are outside this operation; workload impact and other grants still matter.

No seeded role or namespace is installed when templates are missing. Show that
no usable existing template is available rather than manufacture a working demo.

## Plan and ownership safety

- Rust binds each immutable plan to the cluster/session, authorization epoch,
  exact ServiceAccount and referenced-template UID/resourceVersion baselines,
  plus existing binding identities and complete subjects.
- Ownership needs management metadata and exact object/subject identity. A
  matching name or upstream template prefix is insufficient. Unmanaged name
  collisions or bindings containing unrelated subjects block the managed change;
  never delete/recreate a shared binding to make the wizard succeed.
- A plan expires after **120 seconds** and is **consumed once** on apply. It is
  not replayable after an error. A changed authentication/authorization epoch,
  replaced object, stale resourceVersion or changed template requires fresh review.
- Revalidate baselines and permission scope before submission. Deletes carry UID
  and resourceVersion preconditions. Kubernetes binding `roleRef` is immutable;
  any required replacement must be explicit in the planned operations.
- Apply is **not atomic**. Stop after the first failed/conflicted step and report
  submitted/applied/failed/not-submitted outcomes. Do not automatically roll back
  successful steps, replay mutations or present partial success as complete.
- Cancellation stops future work, not server effects already submitted. If an
  outcome is uncertain, refresh Users and reconcile before reviewing another plan.
  Removing a binding is not proof of total access revocation.

## Owners and verification targets

| Source owner | Responsibility | Acceptance evidence to verify |
| --- | --- | --- |
| `src-tauri/src/connection/permissions.rs`, `renewal.rs` | Bounded self-access review, authorization epoch and credential-change invalidation | `permissions/tests.rs`, `permissions/limits_tests.rs`; denied versus unknown, scope isolation, stale results and renewal |
| `src-tauri/src/connection/rbac.rs` | Bounded observed subject/source projections, not universal identity CRUD | `rbac/tests.rs`; incomplete sources and no inferred effective permissions |
| `src-tauri/src/connection/rbac_management.rs` | Managed account/template reads, ownership checks, dry-run, single-use plans and ordered execution | `rbac_management/tests.rs`; exact rules, no seeding/token creation, collision/unrelated-subject rejection, UID/version/epoch conflicts, expiry, replay rejection and partial stop |
| `src-tauri/src/lib.rs` | Thin typed IPC over the shared engine | No arbitrary endpoint, identity override or renderer allow-bit authority |
| `PermissionProvider.tsx`, `PermissionGate.tsx`, `ReadOnlyNotice.tsx` | Ephemeral permission presentation and read-only/unverified distinction | `tests/permissions.spec.ts`; scope changes, known read/write decisions and unknown review |
| `ManagedUsersPage.tsx`, `ManagedUserEditor.tsx`, `managedUsersApi.ts` | Namespace-first Users UI, exact-rule summary, review/confirmation and safe result states | `tests/managed-users.spec.ts`; create, edit, delete, expiry, cancellation, partial results and no credential controls |
| `UsersPage.tsx`, `rbacApi.ts` | Separate observed-subject inspection | `tests/rbac-users.spec.ts`; source coverage, partial lists and no human-account claims |

Paths in the first three rows are relative to `src-tauri/src/connection/` when
only a file name is given; UI owners are under `src/app/cluster/`. These are
implementation/test locations, not passing results. Check loading, empty,
denied, unverified, stale, partial and failed states; keyboard review/cancel/focus;
both themes and narrow-window overflow. Use synthetic credentials, transport
fixtures and mocked IPC only. Never use real kubeconfigs or mutate a cluster for
agent verification.

Combined 0.0.2 build, Rust tests/clippy, browser-fixture suites, packaging and
native smoke verification remain pending unless separately reported with actual
results. No actual cloud helper, live-cluster RBAC, native OS interaction or
credential issuance is verified by this documentation pass.

## Explicitly outside 0.0.2

No token Secret creation, TokenRequest issuance, credential display/export,
generated kubeconfig, CSR approval, human IdP account lifecycle, automatic
upstream migration or full arbitrary Role/ClusterRole/Binding editor is promised.
The existing external identity and cloud-login workflows remain distinct. A
future credential lifecycle requires its own approval and threat model.

## Reference and credits

Inspired by Permission Manager by SIGHUP (BSD-3-Clause).
The workflow reference is [sighupio/permission-manager](https://github.com/sighupio/permission-manager)
at [`fb6f65e161ac792ab290ffe680d6420caf834a43`](https://github.com/sighupio/permission-manager/tree/fb6f65e161ac792ab290ffe680d6420caf834a43)
(`v1.9.0-2-gfb6f65e`, 2023-05-08). Its root
[`LICENSE.md`](https://github.com/sighupio/permission-manager/blob/fb6f65e161ac792ab290ffe680d6420caf834a43/LICENSE.md)
is BSD 3-Clause and states `Copyright (c) 2020, SIGHUP` and `All rights reserved.`
See the [pinned research table](permission-manager.md#2-reference-project-and-research-provenance)
for the upstream wizard, template, binding and credential-export source locations.

The reference informed interactions, not runtime architecture. No upstream source,
assets or seed manifests were copied or adapted for this workflow. Iceon's
implementation is original code under its existing [GPL v3 license](../LICENSE);
this attribution does not relicense it or imply SIGHUP endorsement. Full BSD
redistribution notices are required if upstream code/assets are adapted later;
workflow reference alone is not a claim that BSD source is bundled.
