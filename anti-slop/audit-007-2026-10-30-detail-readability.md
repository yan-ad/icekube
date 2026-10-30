# Inspector, overview and allocation readability audit

Date: 2026-10-30. Mode: audit first, as selected by the user. Application code is unchanged; fixes below await approval by number.

## Direction and scope

Preserve Iceon's Astryx section shell, compact primary resource inventories, theme typography, token spacing and existing actions. The requested cards provide readable boundaries around supporting detail groups and secondary tables, not a card around every primary resource list. Flat, neutral cards with their headings inside provide grouping without shadows or nested card stacks. ENERGY 1 / RHYTHM 1 / MOTION 1 remain appropriate for this operational workspace.

This is a user-requested presentation refinement, not a new Freelens workflow or a claim of upstream parity. No new dependency, Rust command, cluster request or native chrome change is needed for findings 1–4 as scoped here.

## Findings awaiting approval

### 1. HIGH: memory usage disappears into its track

Rules: R-25 (non-text contrast), R-34 (every shipped theme works).

- `src/app/cluster/NodesTable.tsx:27–38` and `src/app/cluster/ClusterOverview.tsx:113–166` select `neutral` for memory and `accent` for CPU.
- A production-browser probe with synthetic 25% memory usage measured identical dark fill and track colors: `rgb(82, 82, 82)`. Contrast is **1.00:1**, so a valid value is visually indistinguishable from an empty track. This is a styling issue, not missing metrics.
- Light mode measured fill `rgb(145,145,145)` and track `rgb(212,212,212)`. It also needs explicit non-text contrast verification, rather than assuming that a visible difference is sufficient.
- Proposed fix: share a theme-aware usage-bar treatment across node cells and overview cards. Keep the rail subdued, but keep the used portion discernible at a minimum 3:1 against it. Preserve numerical values and accessible labels; missing metrics must not become a fabricated zero.
- Acceptance: compare computed fill/track contrast in both themes; exercise 0%, partial use, 100%, over-capacity and unavailable data in node rows and overview cards.

**Allocation distinction:** `src/app/cluster/nodeContract.ts:1–14` exposes `used`, `allocatable` and `capacity`, not requested allocation. The layered requests visualization in the supplied reference cannot truthfully be reconstructed from these fields. This finding fixes the existing usage display. Adding a separate requested-allocation layer requires its own Rust-owned data contract and bounded aggregation design; it is not silently included in this presentation fix.

### 2. MEDIUM: inspector headings do not enclose their content

Rules: R-14 (grouping needs a readability purpose), R-31 (explicit design rationale).

- `src/app/cluster/DetailList.tsx:7–10` supplies only a stack and two-column metadata list, without a card boundary.
- Generic identity and projected sections in `ResourceInspector.tsx:251–279` consequently flow together. `ResourceMetadata.tsx:18–35` leaves labels, annotations and managed fields on the same unbounded surface.
- `PodDetailsView.tsx:56–132` leaves Pod facts, conditions, containers, events and YAML as open stacks. `HelmDetails.tsx:43–60` does the same for identity/history; captured custom-resource summaries use the same unwrapped list in `ResourceInspector.tsx:205–207`.
- `ResourceEventDiagnostic.tsx:7–14` is another supporting detail group without containment.
- Proposed fix: use shared flat Astryx detail-section cards with title and content inside the same boundary. Apply consistently to generic sections, metadata, Pod groups, Helm history and captured summaries. Preserve the list's panel-width-aware two-to-one-column reflow. Group repeated rows within a section rather than adding nested cards around every value.
- Acceptance: generic ResourceQuota/Node details, Pods, Helm charts/releases and captured summaries in light/dark; narrow and expanded panes; 200% text; long keys/UIDs; managed-fields disclosure; YAML controls; loading/error/stale states; Escape and focus return.

### 3. MEDIUM: secondary tables lack their own section boundary

Rules: R-14 (cards serve context separation), R-31 (explicit layout rationale).

- `ClusterOverview.tsx:347–476` renders both Node condition warnings and Latest warning events in one open stack, even though each has a different data scope and read state.
- `WorkloadsOverview.tsx:192–210` renders Latest events in an open stack.
- `DetailCollections.tsx:47–59` renders each related collection's heading, states, retry and table without a card.
- Proposed fix: put each secondary table, its heading and its local feedback inside one flat Astryx card. Keep empty/loading/error content in that boundary too; retries must remain collection-local. Leave primary Nodes/Pods/resource inventories as compact tables without new outer cards.
- Acceptance: overview event/condition links, inspector collection navigation, collection-specific retry, partial/denied/unavailable/empty states, retained stale rows and internal horizontal table scrolling without page overflow.

### 4. LOW: routine explanations compete with the overview data

Rules: R-05 (content-led hierarchy), R-31 (written reason for prominence).

- `ClusterOverview.tsx:308–311,343–353,370–374` presents scope limits, history limitations and ordering explanations as several persistent text blocks.
- `WorkloadsOverview.tsx:181,194` repeats similar explanatory material. `ResourceInspector.tsx:279` adds a routine metadata disclaimer after all details.
- Proposed fix: concise Astryx information icon buttons opening named `Popover` content beside the relevant heading. Keep node counts and the metric values prominent. Explain limits and provenance on demand, not in repeated paragraphs.
- Do not hide actual permission failures, stale snapshots, incomplete results or redaction warnings behind information icons. Keep those visible next to the affected section.
- Acceptance: pointer and keyboard open/close, Escape, focus return, narrow placement and both themes; real error/partial/stale messages stay visible without opening a popover.

## Evidence and baseline validation

- Sources: supplied screenshots; current application source; installed Astryx CLI `ProgressBar`, `Card` and `Popover` documentation. Web search found public Astryx docs at `https://astryx.atmeta.com/components/ProgressBar` and `/components/Popover`, advertising 0.7.4. Installed CLI documentation is the API authority used for this audit; no dependency upgrade was made.
- `bun run build`: passed. Existing large-bundle warning remains.
- Temporary production color probe: confirmed the computed fill/track pairs above for nonzero memory data in dark/light. WCAG script confirmed dark ratio 1.00:1. The temporary probe was removed after measurement.
- Production fixture run (overview probe, detail columns, related collections, workloads overview): 22 passed, 15 failed. Fourteen failures came from mistakenly running dev-source-import collection harnesses against production preview. They do not establish application failures.
- Corrected dev-mode run of collections/workloads suites: 19 passed, 3 failed. Two collection tests still search for an exact `Retry` label, but the current implementation uses `Retry Replica Sets` / `Retry Pods`. One workloads test uses `/^Namespace/`, which matches both `Namespace` and `Namespace options`. These selector mismatches predate this audit and were not changed in audit-first mode.
- The 8 detail-column cases passed in production, covering Node/Pod/Helm chart/release reflow in both themes and 200% text. The 7 cluster-overview baseline cases passed through the temporary probe harness. These tests do not cover the proposed card treatment or establish a complete accessibility pass.

All runtime checks used synthetic metadata and mocked IPC. No real kubeconfig, credential, live cluster, mutation or native OS interaction was accessed. Rust/native smoke tests were not run because this is a presentation audit with no runtime changes. Implementation and acceptance-test updates await selection of finding numbers.
