# Icekube design

## Product and objective

Icekube is a desktop Kubernetes workspace for developers and operators. Freelens
is the reference for user-visible workflows, not the architecture or a promise of
complete compatibility. Keep Icekube's Astryx interface rather than copying
Freelens's styling or Electron implementation.

The objective is to discover clusters, connect deliberately, inspect resources,
and perform operational work without losing cluster or namespace context.
Behavioral targets include:

- A Catalog of clusters and related web links, with search and pinned shortcuts.
- Kubeconfig/context discovery and import, explicit connect/disconnect states,
  and actionable authentication, TLS, network, and permission errors.
- Cluster-scoped resource tables, namespace/filter selection, details, events,
  YAML inspection/editing, and confirmed mutations.
- Logs, exec/terminal sessions, port forwarding, metrics, and Helm workflows as
  separately delivered features, each with cancellation and cleanup.

These are objectives, not a shipped-feature list. Today the app implements the
shell, Catalog as the home screen, category search, navigation history, and the
seamless window frame. The first Rust catalog engine persists imported cluster
context metadata, web links, individual item pins, and random record colors in SQLite.
Built-in discovery imports `~/.kube/config` on catalog load/Refresh.
Background file watching and live watches are not implemented. The connection foundation
now provides explicit Rust-owned session leases, bounded HTTPS client setup, and read-only
Nodes/Namespaces snapshots. Cluster rows open a disconnected workspace with inset navigation;
saved web links open
in the default OS browser through a Rust-owned saved-ID command.
Do not claim Freelens extension compatibility or expose unfinished operations.

## Existing visual direction

The interface is a restrained operational workspace, not a marketing dashboard.
Its recognizable structure is one collapsible sidebar with categories and pinned items,
with compact, aligned resource rows as the main working surface.

| Decision | Direction and reason |
| --- | --- |
| Theme | `src/themes/brand.ts` extends Astryx `neutral`. Neutral surfaces let resource state and selection carry meaning. The installed Matcha package is not an active theme. |
| Color | Theme tokens for surfaces, dividers, text, focus, selection, and semantic state. No page-specific palette or root color overrides. |
| Typography | Astryx theme typography for navigation and reading. Monospace is for YAML, logs, commands, and identifiers where character alignment matters. |
| Structure | `AppShell variant="section"`, with dividers rather than floating cards, keeps navigation distinct without wasting working space. |
| Density | Compact tables and row lists make cluster inventories scannable. Catalog Status cells use Astryx neutral badges as explicitly requested; Labels/source metadata stay plain text. |
| Spacing | Preserve the existing token rhythm: tight toolbar groups, moderate navigation gaps, and roomier page headers/empty states. Current content uses padding step 6 and gaps 4/5. |
| Icons | Tabler icons express concrete actions and resource categories. Icon-only controls always have accessible names and tooltips. |
| Motion | Feedback and necessary transitions only; no decorative animation while users inspect live resources. |

Design dials: **ENERGY 1 / RHYTHM 1 / MOTION 1**. Predictable placement supports
repeated operational work; variation follows content, not decoration.

`src/main.tsx` owns reset/base styles and the Theme provider. `src/App.css` is
unused starter CSS, not design authority. The active brand theme lives in
`src/themes/brand.ts`; new palettes, modes, and fonts belong in the theme.

## Layout anatomy

1. **Window frame:** device insets and a single toolbar with automatic native-control
   clearance when seamless is enabled. No app-name strip or extra title-bar row.
2. **Toolbar:** Sidebar toggle, back/forward history, and Search directly in that top row.
   History controls disable when unavailable. Search opens from its icon button
   or Cmd/Ctrl+K. Add config, Add web link, and Refresh sit beside Search; at narrow
   widths these actions share a keyboard-accessible Catalog actions menu.
   Empty space between actions is draggable in native seamless mode.
3. **Single sidebar:** No separate app rail, Home button, or Welcome destination.
   `/` redirects to `/catalog`. The first toolbar control collapses/expands the
   sidebar on desktop and opens the navigation drawer on narrow windows. Desktop
   collapse preference is saved in non-sensitive localStorage; drawer navigation
   stays fully expanded and does not change that preference.
   Pinned shortcuts identify individual clusters or web links, never
   All Categories, Clusters, or Web Links category pages.
   Opening `/cluster/<id>` temporarily auto-collapses this main navigation; it
   does not overwrite the Catalog collapse preference. The toolbar can expand it
   for the current workspace. Returning to Catalog restores its saved preference.
4. **Sidebar content:** Catalog categories and a pinned-items area share one
   navigation landmark. Collapsed mode keeps named category and pinned-entry
   icons usable, with labels available to assistive technology and tooltips.
   Categories are navigation only; pin actions belong to loaded list entries.
5. **Content:** one main landmark and an accessible, visually hidden page heading.
   No category title bar, discovery switch, or routine explanatory information
   block; the normal view begins with the filter and table. Keep actionable errors
   and loading/empty states visible rather than hiding failures for appearance.
   Resource inventories use
   compact tables; explanatory/empty states use text and specific actions.
   Every category uses `Name | Kind | Source | Labels | Status | Actions`.
   Kind uses the category name and matching sidebar icon; Source identifies
   `kubeconfig` or `local`; Labels show where metadata was loaded, such as
   `file=~/.kube/config` or `file=/absolute/path/config`. Web links have no file
   label and show their saved URL under the name. Status uses neutral Astryx badges
   for Disconnected/Not checked, never an invented healthy/connected state.
   Each entry has a category glyph on a random persisted hex-color background,
   with a black/white glyph chosen by WCAG relative luminance for contrast. Colors
   identify entries only, never health or category; category text remains visible.
   This runtime data color is a deliberate exception to static theme-token colors.
   All Categories combines both kinds. `/catalog` and `/catalog/all` show this view; `/catalog/general` redirects
   to `/catalog/all`. Clusters and Web Links filter the shared snapshot.

### Cluster workspace and row activation

Catalog rows activate with a click, Enter, or Space. Cluster rows and pinned
cluster shortcuts open `/cluster/<saved-id>`; no activation creates a Kubernetes
connection. Pin/Remove buttons and other nested controls never activate their row.
The selected cluster is resolved exactly from the loaded catalog, never guessed
from a name or nearby record. Unknown/deleted IDs show a missing-cluster state.

The workspace adds a cluster-specific inset sidebar beside the collapsed main
sidebar, preserving the Astryx section shell. Its header shows the saved cluster
name, context, persisted icon color, and a Saved context label. The sidebar routes
between Cluster, Nodes, Workloads, Config, Network, Storage, Namespaces, Events,
Helm, Access Control, and Custom Resources. These are navigable workspace sections
with explicit disconnected/not-implemented states. Nodes and Namespaces show read-only
resource tables after explicit connection. The Cluster section shows saved
context/source/labels and verified API version; no fake metrics, events, counts, or terminals.

Section identity is scoped to the cluster route through the validated `section`
search field. History back/forward and direct links retain cluster/section scope.
Switching clusters resets the temporary sidebar expansion. On narrow windows the
shared drawer contains Catalog and Cluster navigation; choosing a section closes
it. Back to Catalog remains available without requiring the drawer.

Web-link rows and pinned web-link actions call `catalog_open_web_link` with only
the saved entry ID. Browser preview never uses `window.open` or directly requests
an external URL. OS handoff errors are shown as safe actionable messages without
changing the current route. Repeat actions are serialized with other catalog work.

Hash routing works in packaged webviews. Navigation state is separate from the
engine's connection state. On narrow windows Astryx moves navigation into its
drawer; keep focus trapping, Escape dismissal, and focus return intact.
Tables may scroll inside their region, but the window must not overflow sideways.
Long identifiers must not push actions or window controls off-screen.

## `seamless` window contract

`seamless` is a window/layout mode, not an Astryx `variant`. It removes the
default OS title-bar surface and automatically supplies safe-area clearance within
the app shell's toolbar. Pages never add their own title-bar margin or spacer.

**Ownership:** `src-tauri/src/window.rs` owns the `SEAMLESS` flag (currently true),
native construction, and platform metadata. `tauri.conf.json` keeps the main
window's dimensions and `create: false` so Rust creates it exactly once.
The initialization script publishes frozen `__ICEKUBE_WINDOW_LAYOUT__` metadata
before React mounts. This metadata is a rendering hint, not a security boundary.
`MainLayout` passes it to the app-owned `WindowFrame` for device insets;
`AppToolbar` passes it to `WindowToolbar` for native-control clearance and actions.

| Environment | Native behavior | Automatically reserved area |
| --- | --- | --- |
| macOS | Overlay title bar with hidden title, retaining real traffic lights and OS behavior. | Traffic-light exclusion region at physical left of the toolbar. |
| Windows/Linux | Decorations disabled; Tauri handles minimize, maximize/restore, close, and drag. | Accessible window controls at the end of the same toolbar, outside drag regions. |
| Browser preview | No native configuration or native API calls. | Device safe-area insets only; no imitation desktop title bar. |
| `seamless: false` | Normal native decorations. | Device safe-area insets only; no duplicate application chrome. |

The toolbar uses spacing tokens and ordinary layout flow, with one reserved height
of spacing-10 + spacing-1. The macOS exclusion width is twice spacing-10. These
are centralized layout budgets, not native measurements; validate them when
changing density, platform integration, or window behavior. Physical device
insets use `env(safe-area-inset-*)`, with `viewport-fit=cover` enabled.
Browser safe-area values alone do not describe macOS traffic-light bounds.

The frame fills the dynamic viewport and gives the shell only the remaining
height. Shell pages scroll internally. The toolbar's native-control clearance remains in
fullscreen too, providing a stable drag/control surface; do not add a second
fullscreen offset. Interactive controls must never be drag targets. Failed
window actions produce an accessible error instead of an unhandled rejection.
Only the required window-control capabilities are granted to the main window.

## Engine boundary

- **Rust/Tauri:** native lifecycle, Kubernetes clients and watches, kubeconfig,
  credentials, filesystem access, durable domain storage, proxies, subprocesses,
  terminals, logs, forwards, metrics, and Helm integration.
- **React/TypeScript webview:** presentation, routes, focus, sorting/filter UI,
  temporary form state, and typed requests/subscriptions to Rust.
- **Node/Bun:** frontend dependencies, Vite/build tooling, and development tests
  only. No Node server, Electron main process, runtime JS backend, or bundled
  Node/Bun sidecar. The packaged frontend is static assets in the system webview.

Keep IPC typed and scoped to a cluster/context/namespace. Rust validates inputs
and authorization regardless of UI state. Streams have bounded buffers and an
explicit cancellation/disposal path. Never send kubeconfig contents, tokens, or
private keys to the renderer merely to display connection status.

The old `icekube.pinned-pages.v1` UI preference is no longer read or written;
existing category pins do not migrate into item pins. Pinned cluster/link identities
are stored through Rust-managed domain storage. localStorage is reserved for non-sensitive UI preferences, not
credentials or cluster domain state.

### First catalog engine slice

`src-tauri/src/catalog.rs` and `catalog/storage.rs` own `catalog.sqlite3` in Tauri's
app-data directory. Commands in `lib.rs` delegate to serialized blocking engine
operations. Normalized metadata, clusters, and web_links tables are updated in
SQLite transactions, with a cross-process lock and bounded storage. Unix
directories/files are private; Windows inherits OS ACLs. Corrupt or unsupported
stores fail closed and are never silently reset. The original `catalog.json`
migrates once, preserving IDs/pins/revision and adding colors; its original bytes
and a non-overwriting `catalog.json.backup` remain. SQLite is authoritative afterward.

- `catalog_list` returns a revision, metadata-only clusters/web links, and a safe
  nullable `discoveryError` code if the built-in default-file scan failed.
- `catalog_import_kubeconfig` accepts an explicit absolute regular-file path.
  Default-file discovery is separate from explicit imports; there is no `KUBECONFIG`
  environment or directory scan. Files are capped at
  1 MiB; only valid named contexts and cluster references enter the catalog.
  Imports reconcile that source, preserve surviving pins/colors, and remove stale contexts.
  No credentials, server addresses, certificates, or auth/exec configuration are
  retained or emitted. The store keeps the canonical source path for identity;
  a separate persisted alias records the selected path for the file provenance
  label, abbreviating the default path to `~/.kube/config`.
  Symbolic links are supported for explicit imports and default discovery,
  including relative/chained targets and paths through linked directories.
  Resolve the target before opening, then require a readable regular file within
  the same size bound. Broken/cyclic links, directories, and special files are
  rejected without changing previous records. Link resolution never executes
  auth plugins or reads any additional kubeconfig files.
  Canonical identity deduplicates alias/direct imports and preserves pins/colors.
  The last successful import selects the displayed alias for a canonical source.
  Retargeting an alias reconciles its old rows; separately selected old targets
  remain. Alias provenance is persisted in SQLite schema 2; schema-1 catalogs
  upgrade transactionally without losing IDs, revision, preferences, pins, or colors.
  Database, lock, sidecar, and legacy-storage symlinks remain rejected. File metadata
  checks are best-effort replacement detection, not a hostile-filesystem race guarantee.
- Default-file discovery is built in, with no setting or routine information UI.
  Every catalog load and Refresh imports metadata from `~/.kube/config`, including
  after restart and for catalogs that previously had discovery disabled. Legacy
  SQLite preference data is retained for compatibility but no longer controls reads;
  there is no `catalog_set_discovery` command or `autoDiscover` response field.
  The home path is supplied by Rust, not the renderer or shell expansion. This is
  not a background file watcher. An absent default file with no previously discovered
  rows is normal and silent. Broken/unreadable/invalid files or disappearance of a
  previously imported default source preserve previous rows and show an actionable
  warning. Mutations do not rescan. Removing an auto-discovered record is local only:
  it returns on the next load/Refresh if still in the file; the dialog explains this.
- `catalog_add_web_link` validates names and HTTP(S) URLs without contacting them.
  Userinfo, query strings, and fragments are rejected to reduce accidental secret
  persistence. This is deliberately narrower than Freelens's URL support.
- `catalog_set_pin` accepts an existing entry ID, never a category route.
- `catalog_remove` removes local metadata and its pin after UI confirmation;
  it does not delete source files or change clusters/websites.
- `catalog_open_web_link` accepts only a saved ID, resolves/revalidates its HTTP(S)
  URL from existing SQLite records, then uses the Rust opener integration with the
  OS-default browser. It does not accept a renderer-supplied URL, migrate/create
  storage, rescan kubeconfig, change pins, or increment catalog revision. Invalid,
  missing, removed, cluster, or tampered-link IDs fail closed. Opener failures map
  to `openFailed`, without emitting underlying platform error details.
  Renderer `opener:default` permission is removed; JS cannot use the opener plugin
  as an arbitrary-URL escape hatch. No application-side website fetch occurs;
  the launched browser handles its own network activity.

The catalog is bounded to 1,000 entries, 4 MiB serialized metadata, and a 16 MiB
SQLite database. Rust generates a random `#RRGGBB` color once for each new entry
using OS randomness and persists it with pins; imports/reloads never reroll it.
Stable IDs deduplicate contexts by source/context and links by normalized URL. Revisions prevent stale
UI responses replacing newer ones. `CatalogProvider` shares snapshots with the
table/sidebar, serializes UI actions, and ignores disposed requests. Errors use
fixed codes mapped to safe messages, never parser output or credential excerpts.
An in-flight local write completes even if its initiating view is disposed; no
watch or background discovery session is started. The UI preserves loaded data
on refresh failure. Browser preview clearly disables engine-backed actions.

### Cluster connection and live resource foundation

`src-tauri/src/connection.rs` owns one main-workspace session lease. Opening a saved
cluster creates a random lease from catalog metadata only. It does not read the
kubeconfig or contact an API. `cluster_connect` requires that exact cluster/lease,
loads the saved canonical source and selected context, then verifies `/version`.
React keeps only typed public session/resource DTOs. Connection state is ephemeral,
not persisted into Catalog's metadata snapshot.

- `cluster_session_open`, `cluster_connect`, `cluster_connection_status`, and
  `cluster_disconnect` scope every action to a saved ID and lease. Workspace change,
  Cancel, Disconnect, and app/window teardown cancel owned work. Late completions
  cannot publish into a replacement lease. Repeated cleanup is idempotent.
- `connection/config.rs` reads the canonical kubeconfig and referenced credential
  files with the existing regular-file/replacement checks and a 1 MiB per-file bound.
  Relative references resolve beside the canonical source. A retargeted provenance
  alias fails with `sourceChanged`. Only the selected context/cluster/user enters
  client setup; `KUBECONFIG`, in-cluster fallback, debug overrides, and scans are not used.
- This slice supports verified HTTPS with static token/basic/client-certificate
  credentials. Exec plugins, auth-provider integrations, explicit proxies, HTTP,
  and insecure TLS skip settings fail closed with fixed codes. Referenced token
  files are snapshotted at connection time; reconnect to pick up credential rotation.
  No auth helper subprocess is launched. Inherited proxy routing is not enabled.
- `connection/transport.rs` uses `kube` 4.2.0 with rustls. It sends only allowlisted
  GETs for version, nodes, and namespaces. Requests have a 15-second deadline,
  four-operation admission bound, cancellation inside the client's buffered service,
  and body limits before JSON parsing (64 KiB version, 2 MiB resource response).
  API error bodies and underlying credential/TLS/transport messages never reach IPC.
- `cluster_resources` fetches at most the first 100 Nodes or Namespaces independently,
  with name/status projection only. Continuation is reported as `truncated`, never
  a total. Monotonic per-read IDs bind `cluster_resources_cancel` to the exact read;
  cancellation-before-registration and out-of-order completions fail closed.
  Tables show loading, empty, denied/error, fetched time, partial, and stale retained
  rows on refresh failure. Connected means the version probe succeeded, not that all
  resource permissions exist or that background health monitoring is running.

Behavior reference remains local Freelens commit
`cd07118f843c4a69f937a319a37a7c12ef2c92d8`:
`common/cluster/cluster.ts` separates connection/accessibility state and
`common/cluster/list-namespaces.injectable.ts` lists namespace names. Icekube keeps
those interactions but uses Rust instead of Electron/Node; no code was copied.
Acceptance: `connection/tests.rs`, `connection/lifecycle_tests.rs`, and
`tests/cluster-connection.spec.ts` cover exact scope, bounded responses, independent
RBAC, cancelled/superseded work, redaction, retry, keyboard use, and narrow layouts.
Tests use synthetic kubeconfigs, an in-memory client service, and mocked IPC only;
they do not prove real-cluster TLS/authentication or native OS integration.

### Reference workflow record

Behavior-only reference: local `/Users/user1/Kerjaa/freelens`,
`v1.10.3-533-gcd07118f`, commit `cd07118f843c4a69f937a319a37a7c12ef2c92d8`.
No upstream source code was copied. `taulens` is not the reference checkout.

| Workflow/source under `packages/core/src/` | Expected interaction / Rust owner | UI states / acceptance |
| --- | --- | --- |
| `renderer/components/catalog/catalog.tsx`, `columns/browse-all.injectable.tsx` | Combined entity inventory with kind/category, category filters; `CatalogEngine::list` | Loading, empty, loaded, filtered-empty, unavailable/error; `tests/catalog.spec.ts` aggregation and legacy redirect |
| `common/catalog/catalog-entity.ts`, `common/catalog-entities/web-link.ts` | Explicit local entities, web-link name/URL, local-only removal; `import_kubeconfig`, `add_web_link`, `remove` | Entry forms, safe validation, saved, confirmed removal; Rust catalog fixtures plus browser import/link/remove tests |
| `renderer/components/catalog/hotbar-toggle-menu-item.tsx` | Toggle shortcuts for entities, not categories; `set_pin` | Persisted pinned/unpinned, item-specific workspace or browser activation; Rust restart/dedup tests plus browser row-pin tests |
| `common/catalog-entities/kubernetes-cluster.ts` (`onRun`), `renderer/components/layout/sidebar.tsx`, `sidebar-cluster.tsx`, `common/sidebar-menu-items-starting-order.ts` | Cluster-ID route, scoped inset navigation, temporary Catalog collapse; Rust owns the session lease and bounded client/resource requests | Loading, disconnected, connecting, connected, permission/transport failure, stale resource data, missing cluster; `tests/catalog-activation.spec.ts` and `tests/cluster-connection.spec.ts` |
| `common/catalog-entities/web-link.ts` (`onRun`) | Open the selected saved link externally; `CatalogEngine::open_web_link_with` and Rust `OpenerExt` replace upstream `window.open` | Success/error without route change; Rust `catalog/open_tests.rs` validates saved IDs/URLs and injected opener, browser activation tests verify IPC-only handoff |

Default-path discovery and the six-column table/colors are Icekube requirements,
not a claim of complete Freelens behavior. Acceptance: Rust discovery/migration/
color fixtures and browser built-in discovery, warning, column/icon, and reload tests.
Authentication helper subprocesses, live watches, mutations, and Freelens
extensions are outside this slice. Tests use synthetic fixtures and mocked IPC;
they do not prove production-cluster or native OS integration.

## Interaction and safety

- Data views distinguish not connected, loading, empty, filtered-empty, stale,
  permission denied, and failed requests. Preserve useful data during reconnects
  and identify stale values; never substitute fabricated metrics or success.
- Show cluster and namespace scope beside operational actions. Destructive
  actions require a specific target and confirmation; Rust owns execution.
- All controls work by keyboard, with visible focus. Dialogs close on Escape
  and return focus. Use named landmarks and status/error announcements.
- Verify WCAG AA contrast in every shipped mode. Color alone never expresses
  connection state, severity, or selection. Native/custom window controls remain
  usable at narrow widths and enlarged text sizes.

## Verification

Run `bun run build`, `bun run test:e2e`, Rust tests, formatting, and strict Clippy
when touching the frame or IPC. Browser tests mock native metadata/commands;
they do not establish OS behavior. Smoke-test the actual app on macOS, Windows,
and Linux for drag, resize, minimize, maximize/restore, close, fullscreen, and
safe-area placement before claiming platform support. Do not operate a real
cluster as a test without explicit approval.

## References

- [Freelens](https://github.com/freelensapp/freelens)
- [Freelens Catalog and navigation](https://freelensapp.github.io/docs/extensions/reference/08-catalog-navigation-theme/)
- [Tauri window customization](https://v2.tauri.app/learn/window-customization/)

Reference behavior must be checked against an identified upstream version when
implementing a workflow. These links describe reference material, not an
Icekube compatibility guarantee.
