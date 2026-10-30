# Node Drain: focused implementation

## Delivered scope

The Node inspector now has **Drain**, alongside Cordon/Uncordon. This batch implements only conservative Node draining; privileged Node shell and historical metrics remain outside it.

Behavioral reference: local Freelens `cd07118f843c4a69f937a319a37a7c12ef2c92d8` (`v1.10.3-533-gcd07118f`), `packages/core/src/renderer/components/node-pod-menu/node-menu.tsx:69-104`. Its command uses `--delete-emptydir-data --ignore-daemonsets --force`. Iceon deliberately does **not** copy those force/local-data defaults or run kubectl. No upstream source was adapted.

Kubernetes references consulted:
- https://kubernetes.io/docs/tasks/administer-cluster/safely-drain-node/
- https://kubernetes.io/docs/concepts/scheduling-eviction/api-eviction/

## Workflow

1. Open the Node inspector and choose **Drain** (inside More actions when compact).
2. Choose **Review drain**. This performs reads and authorization reviews only; opening the dialog does not start review or mutation.
3. Inspect each observed Pod's namespace/name and disposition: evict, skip, wait or block.
4. For a complete, unblocked review, type the Node name exactly and choose **Confirm drain** before the review expires.
5. Rust consumes the server-owned plan, reauthorizes and rechecks the baseline, cordons the Node and submits sequential policy/v1 evictions. It observes Pod removal before proceeding.
6. Keep the outcome report visible. Closing it reloads details and related collections. An accepted eviction alone never becomes a completed-drain claim.

## Owners and commands

- Rust: `src-tauri/src/connection/node_drain.rs` and `node_drain/tests.rs`.
- UI and closed IPC adapters: `src/app/cluster/NodeDrain.tsx`, `nodeDrainApi.ts`.
- Registration: `connection.rs`, `lib.rs`, and the existing development dispatcher in `dev_engine.rs`.
- Permission mapping: `permissions.rs` and `permissionsApi.ts`.
- Pane placement: `ResourceInspector.tsx`, using the existing `InspectorAction` toolbar registration.

Commands: `cluster_node_drain_review`, `cluster_node_drain_execute`, `cluster_node_drain_cancel`. Requests/results are cluster/session/operation-scoped; resource identities require the selected Node UID and resourceVersion.

## Safety and completeness rules

- Plans are server-owned, random-ID, single-use, authorization-epoch-bound and expire monotonically after 120 seconds. Renderer time is only an additional display/confirmation guard.
- Review verifies Node identity/version and lists up to 100 bound Pods with a 2 MiB body cap. Any continuation means partial inventory and blocks execution; it is not treated as an empty or complete Node.
- Missing TypeMeta inside a verified `v1/PodList` is normalized; contradictory types, malformed identities and duplicate namespace/name rows are rejected.
- Supported workload controllers are live-GET verified by namespace/name/API/kind/UID. Unmanaged, unsupported or unavailable controllers block draining.
- Mirror and verified DaemonSet Pods remain. Terminating managed Pods are waited for without eviction. Local `emptyDir`, `hostPath` and unrecognized volume sources block this first version. PVC/CSI backing storage is not certified nonlocal by this workflow.
- Review needs Node get/patch, cluster-wide Pod list, and exact Pod/controller read access. Only eligible `evict` Pods require Pod get plus `create` on core `pods/eviction`; skipped/waiting/blocked Pods do not require eviction rights. No Pod delete permission is requested by Drain.
- Execution rechecks the full reviewed snapshot and authorization before cordon. Node PATCH and eviction deleteOptions use UID/resourceVersion preconditions. Omitted Node spec siblings are preserved.
- Evictions use `policy/v1` at the Pod eviction subresource. No direct DELETE fallback, force deletion, grace-period override, PDB bypass, automatic write retry, rollback or automatic uncordon exists.
- HTTP 429 stops further submissions and reports a PDB-or-rate-limit block; it does not pretend every 429 proves a PDB violation.
- Execution is bounded to 120 seconds, with cancellable reads/waits. Stop/disposal/disconnect prevent further submissions but cannot undo already dispatched writes. Unresolved dispatches remain uncertain.
- Completion requires observed removal of eligible Pods and a final bounded inventory check. New/replacement Pods prevent complete. Skipped Pods remain, and complete is not certification that infrastructure can safely be powered down.
- The operation remains an update/restart blocker until settlement, including cancellation. Old cancellation IDs cannot cancel a newer execution. The renderer never receives raw Pod specs or server diagnostics.

Kubernetes cannot make review, cordon, eviction and final inventory one atomic transaction. Directly bound or taint-tolerating workloads can still arrive, and external actors can change Node scheduling between requests. Identity guards and repeated checks reduce these races; they do not eliminate them.

## Verification

- Drain backend tests: **25** targeted regressions, including omitted list TypeMeta/shared controller checks, contradictory types, blocked/partial inventories, single-use/expired plans, stale baselines, selective eviction rights, cancellation before/after dispatch, PDB rejection, terminating Pods and final replacement Pods.
- Browser verification: **49 passed** across `node-drain.spec.ts`, `node-drain-integration.spec.ts` and existing `node-actions.spec.ts`, one worker, frontend-only Vite on an isolated port. This includes the mounted Node pane, exact requests, report retention, permission/expiry/session states, Stop and narrow keyboard overflow/focus behavior.
- Build passed, with the existing bundle-size advisory.
- Following a timing-fixture correction, **four consecutive full Rust runs passed 469/469**, with 10 repeated successful full-batch permission tests. The correction retains all 32 checks, the 400 ms simulated review latency, concurrency-two limit and production deadline; it controls paused-time advancement around the shared test semaphore.
- Clippy and formatting passed in the final verification pass; earlier compilation/test-placement and timing failures were corrected rather than excluded.

Final current-tree verification: **469/469 Rust library tests**, **49/49 Node browser tests**, frontend build, Clippy with `-D warnings`, and formatting check all passed. Logs: `/tmp/iceon-drain-verified-{rust,browser,build,clippy,fmt}.log`. The build retains the existing large-chunk advisory.

These are source, fake-API and mocked-IPC checks. No real kubeconfig, credentials, native app, live Node drain, eviction, shell or port forward was used. Concurrent repository changes are not a frozen release attestation.
