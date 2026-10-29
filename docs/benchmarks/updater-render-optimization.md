# Avoiding unchanged updater renders

This source change follows the [installed-app comparison](2026-10-29-macos.md).
It does not change those results or establish the cause of their CPU difference.
Iceon's main process accounted for about 0.275 CPU seconds in that capture;
its WebKit content process used about 0.675 seconds. These per-process totals
are observations, not a profile of individual functions.

## Confirmed unnecessary work

`UpdateProvider` reads a bounded updater snapshot once per second. The parser
returns a new object for each response. Previously, even equal snapshots went
through `setSnapshot(next)`, and the context value was a fresh object on every
provider render. That invalidated context consumers, including update blockers
throughout the workspace, even when update state had not changed.

The provider now keeps the previous snapshot object when phase, version, error,
preparation ID and download progress fields are equal. Its context value is also
memoized, so unrelated parent renders do not notify memoized consumers.
[React documents this context identity behavior](https://react.dev/reference/react/useContext#optimizing-re-renders-when-passing-objects-and-functions).

The equality check applies only to React state delivery. It does **not** skip
preparation/freezing logic, error recovery, safety scans or heartbeat reports.
It does not change the one-second polling interval, updater trust verification,
Rust installation gates, Kubernetes refresh cadence, or watch behavior.

## Regression measurement

`tests/update-performance.spec.ts` mounts the real provider with mocked IPC and
an instrumented consumer. Playwright's virtual clock advances the real polling
loop through 120 successful, identical responses. Development React Strict Mode
is enabled, which calls render functions twice; these are render invocations,
not 240 independent DOM commits.

| Fixture | Before | After |
| --- | ---: | ---: |
| Consumer render invocations from 120 unchanged idle polls | 240 | 0 |
| Consumer render invocations from 120 unchanged ready polls | 240 | 0 |

The tests also cover unchanged download progress, stable context across unrelated
parent renders, changed public fields, preparation identities, error recovery,
continuing readiness heartbeats, and cancellation of polling on unmount. Existing
updater tests cover dirty drafts, dialogs, inert preparation, stale preparation
receipts and disposal. All checks use fixtures, not live credentials or updates.

Verification passed 30 isolated Playwright tests covering updater performance,
automatic-update safety, snapshot parsing and native navigation. Type checking
passed earlier; the final workspace check was blocked by concurrent changes in
`DockActions.tsx:42` (`TS2339`, property `current` on `never`). Diff checks passed.
The full browser-suite attempt was
inconclusive: concurrent permission/sidebar edits changed modules during the
run, and overlapping test processes collided in the default artifact directory.
The final updater run used a fresh server and a separate artifact directory.
No full-suite pass is claimed for this patch.

This proves removal of redundant React work in that path, **not** a measured
percentage reduction in CPU, memory or battery use. IPC reads still occur every
second. The installed 0.0.6 application was not rebuilt, replaced or benchmarked
with this source change. A later packaged build needs a fresh native comparison
before claiming an app-level improvement.

## Remaining candidates

- Profile native stacks and IPC activity before attributing the main-process CPU
  difference to a particular command.
- Evaluate change-driven updater delivery if native measurements justify it,
  preserving startup synchronization, preparation IDs and fail-closed readiness.
- Investigate live Pod snapshot clone/serialization cost separately if live sync
  is used. Do not change watch cadence or omit validation to improve a benchmark.
