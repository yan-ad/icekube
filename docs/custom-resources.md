# Custom resources

## Scope

Custom Resources is a read-only workspace workflow. It has three separate data
slots, each owned by Rust and scoped to the current cluster session:

1. **Definitions**: the existing CRD inventory and its ordinary CRD facts.
2. **Custom discovery**: lazy discovery of usable group/kind destinations.
3. **Custom instances**: a metadata-only list for one selected definition.

Definitions and discovered destinations are not a claim that every CRD is loaded.
There is no arbitrary URL input, raw schema browser, custom-object details view,
edit, create, or delete action. Plain names are not converted into dead links.

## Discovery and identity

`src-tauri/src/connection/custom_resources.rs` performs the authoritative work.
A definition is usable only when the named CRD read verifies:

- the expected CRD name and exact metadata UID,
- `status.conditions` contains `Established=True`,
- a valid group, plural and scope,
- a served version, preferring the served storage version.

A changed or replaced UID fails closed. The instance endpoint is constructed only
from these verified CRD fields and validated namespace scope. It is never accepted
from the renderer.

The renderer's `CustomResourcesProvider` keeps discovery independent from instance
reads. Each has its own session cancellation slot. Leaving the workspace, changing
cluster/session, Refresh, timeout, and supersession cancel the exact owned read;
late results cannot publish into a replacement session.

## Bounds and continuation

All ordinary resource responses retain the 2 MiB body bound, 100-item page bound,
15-second request deadline, worker admission limit and cancellation behavior. A CRD
single-object read may use the existing 16 MiB allowance because it is needed to
select a verified definition; its schema is not forwarded to the renderer. Instance
reads request Kubernetes `PartialObjectMetadataList` and project only name, UID,
namespace, creation time and label count.

`CustomResourcesProvider.tsx` schedules lazy discovery through typed Rust IPC,
scanning at most 10 page requests in one batch, within 5 seconds and
up to 1,000 retained definitions. Repeated or malformed continuation tokens fail
rather than merge ambiguous results. If continuation remains, the UI reports a
partial discovery and offers **Load more**. Load more resumes from the retained
opaque token and does not discard the selected definition or instance snapshot.
The existing CRD page starts at limit 10 and can retry an oversized page at limit 1
with the same token. Those are safety bounds, not a guarantee that one page or one
batch contains all cluster definitions.

The batch counts dedicated discovery IPC page requests. An oversized backend CRD
page can make an additional same-token transport retry at limit 1; the UI batch
limit is not a claim of exactly ten HTTP operations.

## UI states

Definitions and instances distinguish loading, empty, filtered/unavailable,
permission failure, timeout, partial continuation and retained stale content.
Changing namespace resets the instance continuation. Automatic refresh stays on
the first instance page; continuation pages are manual snapshots. A missing
selected definition offers Load more when continuation exists, otherwise discovery
Refresh. No failed response is represented as a successful empty table.

## Ownership and acceptance

- Frontend: `CustomResourcesProvider.tsx`, `CustomResourceTable.tsx`,
  `customResourcesApi.ts`, and `ClusterWorkspacePage.tsx` own presentation,
  route state and typed IPC adaptation.
- Rust: `connection/custom_resources.rs` owns path construction, CRD negotiation,
  body limits, projection, request deadlines, session scope and cancellation.
- Tests: `tests/custom-resources.spec.ts` and
  `tests/custom-resource-contract.spec.ts` cover navigation, independent slots,
  partial discovery, Load more continuation, UID replacement, namespace scope,
  metadata-only projection and cancellation. Rust tests under
  `src-tauri/src/connection/custom_resources/` cover transport, bounds, worker
  release and disconnect behavior.

These are fixture and fake-service tests. They do not prove a real cluster,
production RBAC, native window or native file-picker result. Final full-suite
counts for the current uncommitted revision are pending.
