# Validation evidence and limits

## What was observed

- **Source inspection:** requested menus/tables/detail components, shared metadata/conditions/relationships, action registrations/dialogs and backend effects in both local repositories. The workflow chapters cite the files/lines. This establishes implementation paths and gaps, not successful server operations.
- **Supplied images:** Service and Node pane fields/header controls and scrolled sections. Images do not prove action outcomes, permissions, unseen content or the screenshot application's precise version. No resource-specific screenshot values are reproduced in the audit.
- **Browser fixtures:** selected existing Playwright tests with mocked Tauri IPC, not a live Kubernetes connection. Tests exercise actual renderer components, DOM interaction, scopes, cancellation and layout while synthetic responders stand in for Rust.
- **Build:** `bun run build` passed. Vite reported the existing large-chunk warning; passing compilation is not a performance claim.
- **Documentation:** local links, conflict markers and whitespace checked separately before delivery.

No native application was driven, no kubeconfig or credentials were read, and no cluster mutation, helper Pod, exec session, terminal or real forward was started. Existing running native apps were not controlled. Context-menu delete tests dispatch synthetic IPC, not Kubernetes DELETEs.

## Pinned baseline versus moving working tree

Initial Iceon HEAD: `e71baf2d51d2be391485d52dd837f428dc8d21aa`. Freelens HEAD: `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, description `v1.10.3-533-gcd07118f`.

Iceon started with unrelated README, benchmark/tool and performance-test changes. During the audit, additional unrelated design, permission/navigation, dock/create, updater and test changes appeared. This task did not write or revert them. Consequently:

1. A HEAD hash is a baseline label, **not** a claim that every inspected/tested file equals that commit.
2. The workflow chapters describe their inspected working-tree files. Stable resource detail/Node/workload sources were rechecked; changed navigation behavior was qualified explicitly in chapter 02.
3. A final fixture result is a result for the then-current working tree, not an immutable released build.
4. No claim that a later passing run fixes an earlier failure is made. The intervening changes were outside this task.

Concurrent test artifacts were also observed in the default `test-results` directory. Error contexts included `ENOENT` when a browser trace/network recording was missing during teardown. That is concrete artifact interference; it does not explain every assertion failure.

## First broad run: not a passing suite

Command:

```sh
bun run test:e2e tests/workspace-overview.spec.ts tests/workloads-overview.spec.ts \
  tests/nodes-table.spec.ts tests/resource-inspector.spec.ts tests/table-inspector.spec.ts \
  tests/row-context-menu.spec.ts tests/inspector-resize.spec.ts tests/resource-delete.spec.ts \
  tests/resource-tables.spec.ts tests/detail-contract.spec.ts --workers=4
```

The runner selected **347 tests**. The run was **not green**. Failures included missing shared trace artifacts, renderer setup/assertion failures, and a Rust contract-test build timeout. This broad run is not used as evidence of successful parity or as a clean product-regression inventory.

`tests/detail-contract.spec.ts:13-19` compiles Rust on a local run with an `execFileSync` timeout of **150,000 ms**. Cargo was still compiling dependencies when that deadline produced `spawnSync cargo ETIMEDOUT`. No successful 41-kind Rust-to-renderer contract result was obtained by this audit. Compilation progress is not a failing Rust assertion, and this timeout must not be reported as Rust tests passing. No full cargo test/clippy/fmt run is claimed for this documentation-only task.

## Isolated pane validation

To remove shared-port/artifact ownership from the second run, a temporary configuration used:

- Dedicated Vite `http://127.0.0.1:1437`, `--strictPort`, `reuseExistingServer: false`.
- One browser worker.
- Separate output/config/logs under `/tmp/iceon-pane-audit.CXbcpE/`.
- Test timeout 60 seconds, assertion timeout 10 seconds.
- Existing source tests, selected with the title filter recorded in the run log. No tracked test or production file was altered to make the suite pass.

First isolated sweep: **52 passed, 1 failed, 0 skipped** of **53**, duration approximately three minutes. Machine-readable initial summary was retained as `/tmp/iceon-pane-audit.CXbcpE/summary.json`; original log is `run.log`.

| Test file, selected subset only | First isolated result | Evidence scope |
| --- | --- | --- |
| `inspector-resize.spec.ts` | 4 passed | Pointer/keyboard width, expand/restore/reflow, narrow/reduced-motion, close/cancel/disposal |
| `nodes-table.spec.ts` | 9 passed, 1 failed | Core columns/usage semantics, server-scoped fixture search, five metrics-unavailable variants, narrow internal scrolling, empty inventory; initial setup failure in retained-refresh test |
| `resource-inspector.spec.ts` | 19 passed | Requested kind activation, namespace navigation, selection isolation, Escape/focus, stale/late/disposed reads, six theme/width cases, projected facts |
| `row-context-menu.spec.ts` | 4 passed | Nodes/Deployments/DaemonSets/Services right-click Details and keyboard Delete exact-target requests with mocked native-menu IPC |
| `table-inspector.spec.ts` | 1 passed | Node condition/schedulability semantics and detail inspection |
| `workloads-overview.spec.ts` | 8 passed | Counts/status policy, bounded/denied/empty/malformed inventory, namespace cancellation, Event relations/menu |
| `workspace-overview.spec.ts` | 7 passed | Current utilization, warning ordering/related target, missing/stale/partial metrics, error/empty, cancellation |

### Failure diagnosis and repeats

Failed test: `tests/nodes-table.spec.ts:158`, **failed refresh retains rows and flags the snapshot stale**.

- It failed at its **initial fixture table-visible assertion**, before clicking Refresh. The captured page was Connected but showed “Could not load nodes” with the fixture's synthetic `network` error and no table.
- `tests/nodes-table.spec.ts:45-46` uses `if (options.failedRefresh && ++reads > 1) throw "network"` for every `cluster_resources` call, **not just Nodes**. Extra initial reads, another kind or a remount can consume its successful first response. This is a plausible fixture sensitivity, not a proven caller/root cause.
- Repeating the unchanged repository test three times with isolated artifacts initially reproduced the same failure **3/3** (`retry.log`). Increasing timeouts did not address the observed synthetic network state.
- Temporary copies outside the repository were used diagnostically: one only logged IPC on failure, another additionally scoped the counter to Nodes. **Both passed**, including the original failure logic, so this experiment did **not** establish that the counter change fixed the failure. `diagnostic.log` records two passes.
- A subsequent unchanged repository-test repeat passed **3/3** (`final-retry.log`). This task made no source/test fix between those outcomes. Concurrent working-tree and runtime timing changes prevent assigning causality.

Treat this as **observed validation instability**, not a fixed product defect or an infrastructure-only dismissal. A future deterministic investigation should record every resource request kind/readId and permission-driven mount/dispose event, pin a clean tree, and control failure only after the first Node render or explicit manual refresh. That follow-up must not silently normalize duplicate product reads if they are real.

The final isolated full-subset sweep and result are recorded at the end of this document.

## Element-by-element fixture evidence

These checks concern existing Iceon behavior. They do not prove the missing Freelens features exist.

| Element/gesture | Executed assertion |
| --- | --- |
| Cluster warning Involved object button | Starts an exact Event detail relation request, rather than parsing a displayed Pod name. Direct Message text is **not** made clickable by this test. |
| Cluster metrics | Displays synthetic real-sample 25% utilization and known memory denominator; unavailable/stale/missing/partial samples do not invent progress. |
| Cluster empty/error | Distinguishes no warnings/nodes from independent forbidden read; leaves valid information visible. |
| Cluster leave during read | Cancels pending read and ignores later completion. |
| Workloads categories | Count/status derives from returned fixtures; unknown Running metadata is not green; empty is zero, not healthy. |
| Workloads namespace switch | Cancels exact previous pending read; late completion cannot replace current scope. |
| Workloads Event Involved Object | Resolves via backend relation rather than guessed resource identity. |
| Workloads Event Shift+F10/context menu | Offers scoped Event Details only, not edit/delete/runtime actions. |
| Deployment Name | Opens nonmodal right inspector with exact scoped reference; checkbox remains unselected. |
| DaemonSet Name | Same exact-identity inspection behavior; no claim of missing owned-Pod list implementation. |
| Service Name | Opens generic scoped Service inspector; no claim of actual Service forwarding. |
| Node Name | Opens Node inspector, not a terminal or cordon workflow. |
| Node conditions summary/detail | Distinguishes adverse/normal/unknown conditions and exposes omitted-summary conditions in details. The custom-True omission finding is source-derived, not a tested newly fixed case. |
| Table right-click / Shift+F10 | Nodes/Deployments/DaemonSets/Services operate on clicked row, not a neighboring selected row. Synthetic Delete requests only. |
| Checkbox | Selects without inspection. |
| Namespace detail link | Navigates to exact named Namespace and fetches its details. This validates the existing action, **not** equality with the upstream list filter gesture. |
| Close and Escape | Closes pane, returns focus, cancels exact pending read; late completion cannot reopen/navigate. |
| Select another object before reply | Old detail cannot overwrite the latest selection; each disposal cancels its own request. |
| Detail Refresh failure/recovery | Retained facts show stale error, successful recovery replaces them. Separate from the unstable Node inventory test above. |
| Resize grip | Pointer resize reflows table; separator Home/End/Arrow bounds work; expand/restore preserves prior width. |
| Narrow and reduced motion | Separator remains usable; cancellation/disposal ends dragging. |
| Scroll/header/Close | Pane remains inside viewport with internal scroll and visible Close at 1440, 800, 390, in light and dark. These cases use ResourceQuota fixtures on the shared pane, not every long real Node/Service record. |
| Review sections | Synthetic Deployment/Service facts render through the generic section contract. This is not evidence that Rust emits every screenshot field. |

## Still unverified

- Freelens was **not launched or click-tested**. Reference action semantics come from pinned source; the Node/Service screenshots supply visual corroboration only.
- Native Tauri menus, macOS WebKit/traffic lights/fullscreen, Windows/Linux controls and native clipboard/opener behavior were not validated. Chromium IPC mocks are not native smoke evidence.
- No actual Kubernetes API availability, admission/RBAC, deployment scale/restart completion, Node drain/PDB behavior, helper-Pod shell, Service-to-Pod port resolution, metrics provider or Event completeness was verified.
- Missing Labels/Annotations/Managed Fields/related collections/chart/action controls have acceptance proposals, not implemented test results.
- No source-wide all-kind parity, extension compatibility, global sorting/cluster totals, exhaustive accessibility audit or pixel-match claim is made.
- Initial build success preceded later concurrent changes; it is not a release build attestation for a frozen final tree.

## Reproduction without shared artifacts

A future run can use the temporary config while it exists:

```sh
bun run test:e2e --config=/tmp/iceon-pane-audit.CXbcpE/playwright.config.mjs \
  tests/workspace-overview.spec.ts tests/workloads-overview.spec.ts \
  tests/nodes-table.spec.ts tests/resource-inspector.spec.ts \
  tests/table-inspector.spec.ts tests/inspector-resize.spec.ts tests/row-context-menu.spec.ts
```

That command runs all tests in those files unless the original title filter from `final-run.log` is supplied. Do not label a differently selected run “the same 53 checks”. Temporary paths are local diagnostics, not durable checked-in artifacts; this Markdown preserves the relevant results and limitations.

## Final isolated sweep

**53 passed, 0 failed, 0 skipped** in approximately **1.2 minutes**, using the same selected test titles, dedicated port and single-worker temporary configuration. Final log: `/tmp/iceon-pane-audit.CXbcpE/final-run.log`; machine-readable result: `results.json` in the same directory. The final Nodes subset is 10 passes; other per-file counts are unchanged from the first isolated table above.

This is a successful existing-behavior fixture sweep, **not** proof of complete Freelens content/actions or a fix for the earlier unstable setup. The earlier broad failure, first isolated 52/53 result and three failed repeats remain part of the evidence. No production code or tracked test was changed by this task. Native/live checks and the timed-out Rust contract test remain unverified.

Final document checks: all local Markdown links resolve, no conflict markers or trailing whitespace, no copied private screenshot values, and upstream working tree still clean. Only files under `pane-analysis/` were authored by this audit; existing and concurrent unrelated changes were left intact.
