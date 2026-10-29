# Expanded validation and coverage limits

## Scope

This chapter records coordination for the expanded audit chapters 08-14 and the complete [coverage matrix](00-coverage-matrix.md). It does not turn source inspection into live-cluster evidence. No real kubeconfig, credential, Kubernetes API, Helm process, port forward, shell/attach session, native Tauri window or Freelens runtime was used.

The prior requested-pane fixture result is in [07](07-validation.md): its final isolated sweep passed 53/53 selected checks, with earlier instability retained. This chapter covers the additional source families and dialog/dock checks.

## Baseline and working-tree boundary

- Iceon initial baseline: `e71baf2d51d2be391485d52dd837f428dc8d21aa`.
- Freelens reference: `cd07118f843c4a69f937a319a37a7c12ef2c92d8`, `v1.10.3-533-gcd07118f`.
- Iceon was already dirty and unrelated files changed while this audit ran. The expanded reports describe the inspected working tree, not a frozen release. No non-report source or test file was changed by this task.
- Temporary configs, reports, logs and diagnostics were written under `/tmp/iceon-pane-expanded.Z8yFPj/`, not the repository.

## Expanded fixture sweep

The coordinating run used a temporary Playwright config with a dedicated Vite port (`1439`), one worker and separate output artifacts. It selected existing fixture tests from:

- `resource-inspector.spec.ts`
- `pod-workspace.spec.ts`
- `custom-resources.spec.ts`
- `service-tables.spec.ts`
- `helm-install.spec.ts`
- `managed-users.spec.ts`
- `metadata-dialog.spec.ts`
- `preferences.spec.ts`
- `row-context-menu.spec.ts`

**Observed result: 93 passed, 1 failed, 0 skipped** out of 94 selected tests, approximately 7 minutes. Per-file result:

| File | Passed | Failed |
| --- | ---: | ---: |
| `custom-resources.spec.ts` | 5 | 0 |
| `helm-install.spec.ts` | 3 | 0 |
| `managed-users.spec.ts` | 4 | 0 |
| `metadata-dialog.spec.ts` | 2 | 0 |
| `pod-workspace.spec.ts` | 9 | 0 |
| `preferences.spec.ts` | 3 | 1 |
| `resource-inspector.spec.ts` | 58 | 0 |
| `row-context-menu.spec.ts` | 2 | 0 |
| `service-tables.spec.ts` | 7 | 0 |

Passed checks include:

- Generic Name activation and exact relationship navigation for all registered fixture resource views.
- Generic inspector cancellation, focus, resize, stale/error/replacement and projected fact behavior.
- Pod logs buffering/search/pause/wrap/download, shell/attach streams, delete/force-delete/finalize confirmation, reduced YAML conflict retention, forwarding UID resolution and dock lifecycle.
- Dynamic custom-resource discovery paging, UID replacement refusal, partial snapshots and scope cancellation.
- Helm install namespace/release/chart/value validation, server dry-run -> confirmation -> install, invalidation after edit and sanitized failure/uncertainty.
- Managed Users namespace/review/UID-RV/epoch/partial execution/expiry behavior.
- Saved metadata dialog dimensions/focus/Escape.
- Service/Helm forwarding and stale/failed/stop behaviors.

The successful tests are mocked IPC fixture observations. They do not prove Kubernetes server acceptance, native subprocess behavior, or Freelens equivalence.

### Preferences failure

The one failed test was `tests/preferences.spec.ts:132`, **modifies preference, saves, and invokes preferences_save IPC**. It timed out waiting for `Preferences saved.` after clicking Save. The page was at the Catalog with no visible dialog in the failure context, so this run does not establish whether the failure came from modal disposal timing, fixture state, concurrent tree changes or a product regression. The source does set status and schedules a 500 ms close after `save(draft)` (`src/app/preferences/PreferencesDialog.tsx:72-85`), so a test that requires the success text to remain visible needs deterministic modal-lifetime control.

A separate unchanged-test retry reproduced this failure **3/3** with isolated artifacts (`retry.log`). No source fix is claimed. Source tracing identifies a feedback-reset path: `PreferencesProvider.save` updates the preferences snapshot (`PreferencesProvider.tsx:88-94`), then the dialog's effect on `[isOpen, preferences]` clears `status` (`PreferencesDialog.tsx:62-68`) while `handleSave` sets the success message and schedules automatic close (`:72-85`). This is a concrete reason not to credit reliable visible save feedback. A successful IPC save and persisted value must be checked separately from transient success-text visibility; the temporary persistence probe is recorded below.

## Read-only Pod probes

Two temporary copies of the existing Pod fixture were used for targeted observation only, with no `cluster_pod_mutate`, stream or forward submission:

1. **Denied events:** synthetic Pod response carried backend-style `eventsState: denied` and an empty events array. The current frontend DTO/parser does not admit or render `eventsState`, and the pane displayed **No events returned.** The probe passed, confirming the source finding in [08](08-pods-and-runtime.md): a denied/unavailable/partial events read can appear identical to a successful empty result.
2. **Patch-only edit:** synthetic permission review denied `update` but allowed `patch`. `PodDetailsView` enables Edit YAML with `update OR patch`; the probe showed Edit YAML enabled. No mutation was submitted. Rust `pod_mutate` maps Replace to Update and sends `PUT` after requiring Update (`pods.rs:291-365`). This confirms a UI contract mismatch, not an unauthorized server write.

These probes are not product fixes and were not added to tracked tests.

### Preferences persistence probe

A third temporary fixture probe clicked Save, asserted exactly one `preferences_save` request, waited for dialog closure, reopened Preferences and confirmed the saved proxy value. It **passed (1/1)**. Combined with the unchanged save-feedback test failing 3/3, this separates persisted state from missing transient feedback. It does not verify real SQLite writes or actual proxy consumer behavior. The fixture's value is synthetic loopback configuration; no connection was made. Log: `preferences-probe.log` in the temporary directory.

## Build and documentation checks

- `bun run build` **passed** again after the expanded report work. `/tmp/iceon-pane-expanded.Z8yFPj/build.log` retains the existing Vite chunk-size warning, not a correctness failure.
- `git diff --check -- pane-analysis` was run after report edits.
- Coverage mapping generated `coverage-map.json` under the temporary directory and verified **41/41** built-in kinds map to an audit chapter.
- Local report-link/content checks found all expected links except the intentionally forthcoming `15-expanded-validation.md` links before this file was created; those links are now satisfied. The final check must include the new coverage matrix and this file.
- Freelens detail registration inventory contains 43 files: 41 kind registrations plus shared Event/kube-event infrastructure. The audit covers the 41 kinds and treats shared Event behavior in chapters 01, 08, 13 and 06. Extension-contributed panes are excluded.

### Cross-report correction: backend owner references are not rendered links

`details.rs:398-415` can produce `controlledBy` references for all workload kinds. However, `resources.rs:423-426` only inserts its display column for **Pods**, and `ResourceInspector.tsx:235-237` only renders relation links encountered while iterating item columns. Consequently ReplicaSet -> Deployment and Job -> CronJob owner refs are not usable links in the current generic workload panes. Chapter 09 was corrected, as was the Deployment projection wording. This distinction is source-confirmed, not an executed relationship test with real objects.

## Still unverified

- Freelens was not launched or click-tested. Its behavior is pinned-source analysis supplemented by the supplied Service/Node images.
- No native Tauri/WebKit/macOS window, fullscreen, clipboard, OS opener, menu event or shell capability was validated.
- No live RBAC, API discovery, metrics-server, admission policy, PDB/eviction, controller rollout, CSI/storage, Helm repository, Helm release, Service forwarding or browser handoff was performed.
- No resource mutation was sent to a cluster. Mocked IPC requests only verify renderer request construction and state transitions.
- No extension compatibility, full source equivalence, pixel match, global sorting completeness or all-kind real-server parity claim is made.
- Intentional withheld fields (Secret/ConfigMap values, tokens, raw YAML, CA/private key material, arbitrary custom-resource payloads) remain outside the parity target unless separately approved with Rust-owned data-minimization contracts.

## Final status interpretation

The expanded audit is complete as a **source and fixture review**. It identifies every built-in pane and adjacent global/dynamic surface, records current fields and action chains, and names the Rust/UI owners and acceptance states for each material gap. It does **not** claim that all panes currently match Freelens; the coverage matrix intentionally lists where they do not.

Final executed status: **93/94** selected existing checks passed; the Preferences feedback failure reproduced **3/3**. **Two Pod read-only probes and one Preferences persistence probe passed.** Build passed. Report links, 41-kind mapping, whitespace and upstream cleanliness were checked. No failed check was hidden or converted into a pass by changing production code or tracked tests.
