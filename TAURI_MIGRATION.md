# Freelens Electron-to-Tauri migration

## Objective and scope

Replace Electron as Freelens's desktop host with Tauri while preserving existing
application behavior, business logic, user data, and supported extension contracts.
This document defines the migration sequence and the required parity checks. It is
not evidence that Tauri already provides those behaviors.

Only changes necessary for the port belong in this work:

- Replace Electron lifecycle, windows, IPC, protocols, and native integrations.
- Adapt Node-dependent renderer integration so the existing application can run in
  a system webview.
- Package and supervise the existing JavaScript backend using a bundled Node.js
  runtime.
- Replace Electron-specific build, packaging, and test infrastructure.
- Add migration-specific adapters, fixtures, and parity tests.

Do not redesign the UI, rewrite Kubernetes logic in Rust, replace state management,
change storage schemas, upgrade unrelated dependencies, add features, or fix
unrelated defects. Preserve existing failures and unsupported operations unless
maintainers explicitly authorize a separate behavior change. A security regression
is not an acceptable way to obtain parity; stop and resolve the conflicting
requirement instead.

## What complete migration means

A thin-wrapper replacement with unchanged source is not possible. The application
currently depends on Node-enabled renderers and Electron APIs. A port can preserve
business logic while changing the integration code that supplies those APIs.

Completion requires all of the following:

1. Supported desktop packages launch without Electron installed or embedded.
2. Existing application workflows produce equivalent results on supported targets.
3. User data, settings, installed extensions, and supported public APIs remain
   compatible.
4. Native integration preserves platform-specific behavior and trust boundaries.
5. Every required parity item below has implementation ownership and passing
   evidence. An unknown, skipped test, or unsupported replacement is not a pass.

Electron's internal process IDs, Chromium implementation, ASAR container, and
browser-specific error names do not need literal replication unless application
code or a supported API exposes their semantics. Their replacement must preserve
the observable contract. Identical pixels across different system webviews cannot
be assumed; rendering and interaction equivalence need explicit tests.

The inventory below is a starting set of required obligations, not a claim that a
source review proves every runtime path. Expand it whenever a baseline test,
source audit, dependency, or extension exposes another host dependency. Do not
claim full parity while an integration surface remains unenumerated.

## Source contracts

Paths in this document are relative to the repository root. The following are
starting points for implementation and baseline tests:

| Area | Source of existing behavior |
| --- | --- |
| Application startup and dependency injection | `freelens/src/main/index.ts`; `packages/technical-features/application/application-for-electron-main/src/` |
| Browser window and frame integration | `packages/core/src/main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts` |
| Lifecycle, single instance, shutdown, deep links | `packages/core/src/main/electron-app/runnables/` |
| Legacy IPC and extension IPC | `packages/core/src/common/ipc/ipc.ts`; `packages/core/src/renderer/ipc/`; `packages/core/src/extensions/ipc/` |
| Injectable messaging | `packages/technical-features/messaging/` |
| Synthetic hostnames and proxy configuration | `packages/core/src/main/start-main-application/runnables/`; `packages/core/src/main/utils/resolve-system-proxy/` |
| Local certificate verification | `packages/core/src/main/start-main-application/lens-window/application-window/session-certificate-verifier.injectable.ts` |
| Backend HTTP and WebSocket routing | `packages/core/src/main/freelens-proxy/`; `packages/core/src/main/routes/` |
| Persistent state and synchronous initialization | `packages/core/src/features/persistent-storage/`; `packages/core/src/common/get-configuration-file-model/` |
| Paths and imported kubeconfigs | `packages/core/src/common/app-paths/`; `packages/core/src/main/kubeconfig-manager/` |
| PTYs and terminal identity | `packages/core/src/main/shell-session/`; `packages/core/src/renderer/components/dock/terminal/` |
| Kubernetes proxy and cluster authentication | `packages/core/src/main/freelens-k8s-proxy/`; `packages/core/src/main/cluster/` |
| Host tools and downloads | `packages/core/src/main/kubectl/`; `packages/core/src/main/kube-tools/`; `packages/core/src/main/fetch/`; `packages/ensure-binaries/` |
| Extension guarantees | [Extension API](docs/extensions/api.md); [Extension binaries](docs/extensions/binaries.md) |
| Extension loading and resource serving | `packages/core/src/extensions/extension-loader/`; `packages/core/src/features/extensions/loader/` |
| Renderer Node externals and worker bundling | `freelens/electron.vite.config.ts`; `packages/core/src/renderer/monaco/setup-monaco-environment.ts` |
| Environment boundaries and existing exceptions | `tsconfig.main.json`; `tsconfig.renderer.json`; `scripts/type-check-environments/legacy.jsonc` |
| Packaging and integration tests | `freelens/electron-builder.yml`; `freelens/vitest.integration.config.ts`; `freelens/integration/` |

Read the relevant implementation before replacing it. Directory-level anchors do
not establish that every API in that directory is exercised at runtime.

## Target architecture

```text
Tauri desktop host
  |-- native lifecycle, windows, menus, tray, dialogs, OS integration
  |-- capability enforcement and authenticated IPC routing
  |-- bundled Node backend supervision
  |
  |-- system webview
  |     |-- existing React / MobX UI and domain logic
  |     |-- cluster frame isolation
  |     |-- browser-compatible platform adapters
  |     `-- renderer extension API and host-provided singletons
  |
  `-- bundled Node backend
        |-- existing backend services and main dependency injection
        |-- Kubernetes HTTP / WebSocket proxy and credential execution
        |-- persistence, filesystem, downloads, and process execution
        |-- node-pty and terminal sessions
        |-- main extension runtime
        `-- existing kubectl, helm, and freelens-k8s-proxy executables
```

This is the proposed minimum-change architecture, conditional on the feasibility
gates below. Tauri does not embed Node into a webview. A Node sidecar does not
provide Electron APIs merely because the original backend ran in JavaScript.

### Ownership rules

- Keep application algorithms, API transformations, validation, and business state
  in their existing TypeScript modules where possible.
- Replace host implementations at existing injectable boundaries. Add a narrow
  boundary only where direct host access prevents substitution.
- Keep Node-bound services in the Node backend. Rust owns desktop integration and
  supervision, not a duplicate implementation of Kubernetes business logic.
- Keep one authoritative owner for persisted state and each process resource.
  Renderer mirrors must preserve existing initialization and synchronization
  semantics without competing writes.
- Give each window and cluster frame a trusted routing identity. Do not accept a
  caller-supplied cluster ID as authorization.
- Preserve lifecycle ordering before extension activation and first render.
- Audit transitive renderer dependencies as well as direct imports. The existing
  renderer bundler deliberately preserves runtime `require` calls and mutable
  Node module identity; an alias for `electron` alone is insufficient.

### Backend transport

Select the sidecar transport during the feasibility work. Prefer an owned pipe or
another private authenticated channel. If loopback HTTP or WebSockets are needed,
use explicit binding, per-run authentication, origin checks, request scoping, and
shutdown cleanup. Preserve the authentication of existing backend routes as well.
No static secret, wildcard privileged bridge, arbitrary renderer command execution,
or unrestricted filesystem command is acceptable.

Define request correlation, response/error encoding, binary payload handling,
listener disposal, cancellation where supported, stream backpressure, and startup
readiness. Preserve ordering required by the existing APIs; do not impose a global
ordering on unrelated messages. Do not add new retry or recovery semantics under
the name of transport compatibility.

## Feasibility gates

Resolve these before broad implementation. Failure means revise the host approach
or request an explicit scope decision, not silently remove a capability.

| ID | Constraint | Required proof |
| --- | --- | --- |
| G-01 | The main page and subframes currently have Node integration and no context isolation. | Enumerate direct and transitive runtime Node/Electron use; demonstrate a browser-compatible path for every reachable renderer dependency. |
| G-02 | Persistent storage initialization and some filesystem/clipboard APIs are synchronous. Tauri frontend IPC is asynchronous. | Demonstrate bootstrap snapshots or another justified adapter that preserves immediate reads, callback signatures, ordering, and persistence semantics. Dynamic reads that cannot be cached remain blockers. |
| G-03 | Cluster views use synthetic HTTPS subdomains, local certificate trust, hostname mapping, and frame-targeted IPC. | Demonstrate routing, TLS validation, origin isolation, navigation, fetch, workers, and targeted IPC on each desktop webview. Do not disable TLS validation or collapse cluster origins to make tests pass. |
| G-04 | Renderer extensions load ESM through the privileged `freelens-extension` scheme. | Demonstrate entry imports, relative imports, top-level await, CSS/assets, MIME types, CORS, development reload, and traversal protection on each target. |
| G-05 | The main-extension contract promises both Node and Electron. A plain Node process cannot fulfill arbitrary Electron imports. | Enumerate the documented guarantee and actual required APIs. Prove a compatibility implementation against the contract, or explicitly resolve the incompatibility. Retaining an Electron helper fails the Electron-free completion requirement; narrowing compatibility fails full parity. |
| G-06 | Tauri capability checks cannot distinguish iframe requests from parent-window requests on some platforms, including Linux. | Demonstrate equivalent cluster/frame authorization using a trusted routing design. Broad remote URL permissions do not prove frame isolation. |
| G-07 | Host terminal execution depends on native node-pty resources. | Load and exercise the packaged native addon and its helpers using the chosen Node runtime on every release platform/architecture. N-API compatibility alone is not packaged-runtime proof. |
| G-08 | The web engine changes from bundled Chromium to platform webviews. | Demonstrate required JavaScript, CSS, drag/drop, workers, editor, terminal, storage, clipboard, focus, and accessibility behavior on the minimum supported webview versions. |
| G-09 | Integration tests launch Electron through Playwright. | Establish a packaged Tauri automation path for each platform and prove cluster-frame access. Choose a tested macOS driver; do not assume Chromium CDP or Electron launch APIs apply to WKWebView. |
| G-10 | Installer identity and application paths are host-dependent. | Demonstrate an upgrade from the Electron package with the same user-visible identity, data, extension discovery, protocol registration, and supported install modes. |

For G-05, validating a small fixture does not prove compatibility with arbitrary
third-party use of the promised Electron module. Full parity is blocked until the
promise has an implementable boundary or a complete compatibility solution.

## Parity register

The IDs below are stable acceptance identifiers. Every row is required wherever
that behavior exists on a supported target. Attach source anchors, implementation
owner, and test evidence to each ID during implementation. Do not infer a pass from
its presence in this document.

### Application lifecycle and windows

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| LIFE-01 | Dependency injection and startup phase ordering | Pre-ready hooks, backend readiness, bundled extension readiness, first window, root-frame readiness, startup rejection and exit behavior. |
| LIFE-02 | Single application instance | First launch, competing launch, arguments delivered to the existing instance, focus/show behavior, lock release after exit. |
| LIFE-03 | Last-window close behavior | Frontend cleanup; stay alive with tray enabled; quit when required by preferences or integration mode; reopening does not duplicate backend services. |
| LIFE-04 | Graceful quit | Backend cleanup runs once; pending cleanup completes; success/failure exit behavior matches; proxy and PTY processes do not remain unexpectedly. |
| LIFE-05 | Activation and OS shutdown | Reopen/show on activation, platform dock behavior, shutdown handling, forced versus graceful exit paths. |
| LIFE-06 | Window geometry and chrome | Persisted size/position, minimum dimensions, hidden-until-ready behavior, maximize/minimize, title bars, icons, multiple displays and display removal. |
| LIFE-07 | Window events and navigation | Focus/blur/closed/readiness events, focused-window actions, back/forward availability, reload and history clearing. |
| LIFE-08 | Loading failures | Equivalent bounded retry for the existing retryable failure classes, delay behavior, logging, non-retryable failures. Do not copy Chromium error codes without mapping their meaning. |
| LIFE-09 | Auxiliary windows and links | License and other existing auxiliary windows receive their data; denied popups remain denied; permitted external links use the OS browser. |

### IPC, identity, and synchronization

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| IPC-01 | Legacy invoke/send/listener APIs | Channel names, argument order, return values, error behavior, MobX payload sanitization, listener lifecycle, supported payload types. |
| IPC-02 | Injectable request/message channels | Existing injection tokens and call signatures, handler registration, request/response semantics, message delivery; unsupported requests from main remain unsupported. |
| IPC-03 | Broadcast semantics | Delivery to intended main listeners, windows, and registered cluster frames; destroyed destinations are handled without disrupting other recipients. |
| IPC-04 | Frame-addressed messages | Root versus cluster delivery, window/cluster/tab identity, frame registration and removal, reload, multiple concurrent clusters, no cross-cluster delivery. |
| IPC-05 | Extension IPC | Channel namespacing, invoke/send/listener behavior, activation/deactivation disposal, error and payload compatibility. |
| IPC-06 | State synchronization ordering | Initial state is available at the same lifecycle point; updates do not echo indefinitely, race with startup, duplicate reactions, or disappear during reload. |
| IPC-07 | Transport lifecycle | No reply crosses request identities; supported cancellation/disposal remains effective; streams obey backpressure; disconnects produce defined errors without invented retries. |
| IPC-08 | Privileged caller authorization | Reject forged cluster/window identities, untrusted frames, navigated-away pages, and unauthorized remote origins; isolate credentials and process controls. |

### Networking, local origins, and downloads

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| NET-01 | Root and cluster origin routing | Synthetic host routing, loopback binding, dynamic ports, URL-derived cluster identity, relative routes, reload and concurrent cluster isolation. |
| NET-02 | Local certificate trust | Trust only the intended local proxy certificate; unrelated certificates retain normal platform verification; expired, replaced, or mismatched certificates do not receive a global bypass. |
| NET-03 | System proxy configuration | Existing system-proxy resolution, proxy rules, direct mode, local bypass rules, command-line precedence, environment handling, failure logging. |
| NET-04 | Backend HTTP requests | Methods, bodies, headers, status/error mapping, proxy support, timeouts, response serialization, binary data, extension HTTP behavior. |
| NET-05 | WebSocket and streaming routes | Terminal/log/resource streams, authentication, reconnect behavior where already supported, close codes, cancellation, sustained traffic and backpressure. |
| NET-06 | Terminal route authentication | Cluster/standalone and tab scoping, token minting, one-use token consumption, timing-safe verification, invalid/replayed token rejection. |
| NET-07 | Extension protocol serving | Secure scheme behavior, allowed roots, relative resource resolution, URL encoding, MIME/CORS behavior, no traversal or arbitrary file exposure. |
| NET-08 | File and binary downloads | Proxy-aware fetch, progress/stall and total timeouts, binary integrity, local callbacks versus serialized options, error propagation, partial-file cleanup. |
| NET-09 | Session and browser state | Preserve any application-relevant shared session, cookie, origin-storage, cache, and authentication behavior found in baseline scenarios; do not invent a separate cookie-management feature. |
| NET-10 | Frontend security policy | Required CSP, fetch, workers, extension resources, iframe policy, and external-navigation restrictions work without wildcard privileged access. |

### Persistence, files, and user data

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| DATA-01 | Existing user-data location and identity | Existing profile is discovered in place; no surprise empty profile; platform app paths, custom supported paths, and test-only overrides preserve their restrictions. |
| DATA-02 | Configuration schemas and migrations | Existing names, defaults, serialized fields, migration ordering and error handling; no schema redesign or destructive conversion. |
| DATA-03 | Synchronous initial store state | `loadAndStartSyncing` and `fromStore` preserve their signatures and immediate observable results before UI/extension consumers execute. |
| DATA-04 | Persisted state replication | Single authoritative writer, existing reaction/equality semantics, repeated setup/disposal, no feedback loops, cross-window updates and restart persistence. |
| DATA-05 | User-facing stores | Preferences, clusters, hotbars, favorites, weblinks, extension enablement and installed-extension metadata round-trip without losing fields. |
| DATA-06 | Extension storage and data directories | Existing `extension-store` and `extension_data` paths, per-store identity, initialization and sync behavior, install/remove/reload behavior. |
| DATA-07 | Kubeconfig lifecycle | Import, permissions, parsing, contexts, proxy kubeconfig/cache creation, temp-path behavior, best-effort cleanup, no accidental credential disclosure. |
| DATA-08 | Filesystem integration | Existing file-picker paths, user templates, file reads/writes, synchronous operations, streams, watchers where used, permission errors, Unicode, spaces and Windows paths. |
| DATA-09 | Browser-owned state and credentials | Inventory used local/session storage and credential locations; preserve needed origin data and ownership without asserting that JSON stores are encrypted or keychain-backed. |
| DATA-10 | Upgrade and rollback safety | Upgrade reads a real existing profile; cancelling/failing migration does not destroy it; Electron can reopen data when no approved format change exists; only one host writes the profile at a time. |

### Kubernetes and existing application workflows

These are regression obligations, not permission to rewrite their implementation.
Exercise the existing screens, commands, and failure paths against equivalent
cluster fixtures and authorization levels.

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| KUBE-01 | Cluster discovery and connection | Add/import/select/remove clusters, context identity, connection state, unavailable cluster handling, multiple concurrent clusters. |
| KUBE-02 | Authentication and credential plugins | Login-shell environment, exec-plugin launch, arguments, cwd, credential refresh, failure classification, existing authentication backoff and cancellation. |
| KUBE-03 | Kubernetes proxy lifecycle | Existing proxy executable, arguments, environment, readiness and endpoint discovery, startup failures, cluster disconnect and application cleanup. |
| KUBE-04 | Resource reads and watches | Lists/details, namespace filtering, live updates, custom resources, RBAC errors, resource deletion/recreation and reconnect behavior. |
| KUBE-05 | Existing mutating workflows | Create/edit/apply/delete and other existing resource actions preserve payloads, confirmations, validation, errors and resulting state. |
| KUBE-06 | Metrics and charts | Existing metrics queries, Prometheus integration, refresh/disposal, unavailable metrics behavior, chart rendering. |
| KUBE-07 | Helm workflows | Repositories/charts/releases and existing install/upgrade/remove flows preserve executable selection, arguments, environment, results and errors. |
| KUBE-08 | Logs and exported files | Pod logs, follow/pause/filter, log-to-file behavior, single/all-log downloads, large output, cancellation and tab disposal. |
| KUBE-09 | Other host-backed cluster actions | Enumerate existing exec/attach/port-forward and browser-opening paths from source and fixtures; preserve each supported path, port ownership and cleanup without adding new capabilities. |
| KUBE-10 | Navigation and workspace state | Catalog, hotbar, favorites, command palette, preferences, weblinks and extension routes behave identically across root and cluster frames. |

### Terminals, subprocesses, and bundled tools

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| TERM-01 | PTY creation | Same shell selection, arguments, cwd fallback, initial dimensions, terminal name, environment and platform-specific PTY options. |
| TERM-02 | Terminal identity and reuse | Cluster/standalone session plus terminal ID, existing process reuse/resume, tab close/reopen, no cross-session process attachment. |
| TERM-03 | Interactive behavior | Input/output ordering, resize, UTF-8, ANSI/color, shell prompts, multiline output, large output, exit status, selection, copy/paste and links. |
| TERM-04 | Process ownership and cleanup | Dispose, disconnect, quit, failed spawn and backend exit clean up owned PTYs and child processes according to existing behavior. |
| TERM-05 | Shell environment discovery | Platform-specific discovery, login/interactive configuration behavior, abort timeout, fallback, caching, background refresh, preservation of embedded newlines and equals signs. |
| TERM-06 | Environment composition | Cluster versus standalone behavior, proxy kubeconfig/cache variables, existing proxy rules, single `PATH` spelling on Windows, extension modifiers only where currently applied. |
| TOOL-01 | Binary discovery and preferences | Existing kubectl/helm and download-directory preferences, bundled fallback, platform/architecture resources and executable modes. |
| TOOL-02 | Version-matched kubectl | Existing selection, shared concurrent preparation, missing-pin refusal, fallback, SHA-256 checking, restrictive temp file and executable permission behavior. |
| TOOL-03 | Build-time binary integrity | Retain committed locks, publisher-verification workflow for generated pins, version/digest consistency and refusal of mismatched downloads. Do not weaken the existing verification boundary. |
| TOOL-04 | Packaged native dependencies | Bundled Node loads node-pty and required native/helper files without local development tools, a global Node installation, or Electron. |

### Extension contracts

The normative requirements are C1 through C15 in
[the extension API specification](docs/extensions/api.md). This table does not
replace or narrow them. A compatible fixture is necessary but insufficient when
the documented contract permits more than that fixture exercises.

| ID | Contract | Required parity |
| --- | --- | --- |
| EXT-01 | C1: Packaging and publication | Published package entry points, declarations, runtime shim and install layout remain consumable without host-private dependencies. |
| EXT-02 | C2: Runtime-global API | Correct Common/Main/Renderer namespaces in the right processes, availability timing and runtime value/type agreement. |
| EXT-03 | C3: Host-provided singletons | Preserve the same React, MobX, Monaco and other specified singleton objects within each relevant runtime; assert object identity and observable reactions. |
| EXT-04 | C4: Module format and loading | Main ESM/CJS, renderer ESM, top-level await, main Node/Electron guarantee, relative imports, CSS loading, format-specific reload/restart behavior. G-05 applies. |
| EXT-05 | C5: Namespace enumeration | Preserve supported namespace members and their declared/runtime meanings; no silent reduction of exports. |
| EXT-06 | C6: Registration and extension instance | Declarative registrations, lifecycle, activation/deactivation, instance properties, manifest-relative resources, cleanup and reload. |
| EXT-07 | C7: Dependency injection | Existing supported DI view, registration and injection behavior; do not expose replacement host internals as new API. |
| EXT-08 | C8: React | Host React/renderer compatibility, hooks, context, component lifecycle and registration mounting. |
| EXT-09 | C9: Routing | Existing route registration, root versus cluster navigation, special characters, deep navigation and history semantics. |
| EXT-10 | C10: Styling and CSS | Existing public classes, theme variables, extension styles/assets and style disposal; no redesign or class renaming. |
| EXT-11 | C11: Bundled third-party libraries | Existing host-provided library surface and identity; no extra copies that alter behavior. |
| EXT-12 | C12: HTTP | Existing host HTTP request options, return/error semantics, proxy behavior, timeouts and binary handling. |
| EXT-13 | C13: Consumer toolchain floors | Preserve the documented consumer build contract; reject incompatible browser/runtime features before claiming support. |
| EXT-14 | C14: Versioning and compatibility | Existing `engines.freelens` gate and compatibility rules; do not disguise API breaks as host-only changes. |
| EXT-15 | C15: Host tools and environment | kubectl/helm path preparation and fallback, environment composition, connected-cluster requirement, concurrency and exclusion of terminal-only modifiers where specified. |
| EXT-16 | Installation and discovery | Archive validation, extraction, managed/dev layouts, permissions, enable/disable/uninstall and discovery errors. |
| EXT-17 | Shipping executables | Preserve [extension binary rules](docs/extensions/binaries.md), cwd/env ownership and executable permission handling; host signing does not imply third-party binary signing. |
| EXT-18 | Unsupported native addons | Do not add a Node ABI guarantee or `.node` addon support for extensions; host node-pty support does not change this restriction. |
| EXT-19 | Failures and disposal | Invalid manifest, incompatible engine, missing entry, rejected activation, failed import, bad resource path, teardown and reload leave no stale registrations/listeners. |

Renderer Node/Electron access is not guaranteed by C4, but core renderer Node use
still must be ported. That distinction does not remove the separate promise of
Electron availability in main extensions.

### Renderer and desktop integration

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| UI-01 | Existing UI composition | Same screens, actions, text, menus, loading/error/empty states, theme variables, public CSS classes and layout behavior. |
| UI-02 | Monaco and module workers | Editor/JSON workers load in root and cluster contexts, YAML/JSON editing and validation, models, completion, disposal, asset URLs and CSP. |
| UI-03 | File and clipboard workflows | File picker, import/export/save, clipboard formats/text, synchronous consumers, permission denial, drag/drop and keyboard paste. |
| UI-04 | Keyboard, focus and accessibility | Existing shortcuts/accelerators, command palette, modal focus, tab order, keyboard navigation, accessible labels, IME and screen-reader access. |
| UI-05 | Theme, scale and rendering | Native theme changes, fonts/icons, dark/light themes, high DPI, zoom where exposed, minimum-window layout and platform webview rendering. |
| UI-06 | Browser-dependent APIs | Required worker, Web Crypto, fetch, WebSocket, URL, storage and JavaScript/CSS features work on the minimum supported engine; only necessary compatibility changes are allowed. |
| OS-01 | Application menus | Existing item IDs/actions, enabled/checked states, dynamic updates, accelerators, platform placement and focused-window behavior. |
| OS-02 | Tray and dock | Visibility preference, dynamic icons/tooltips/menus, Windows click behavior, reopen action, dock visibility and cleanup. |
| OS-03 | Native dialogs | Existing open/message/save flows where used, filters, selection, cancellation, modality and returned path/error shapes. |
| OS-04 | Deep links | `freelens` scheme, cold/warm launch, OS open-url delivery, second-instance arguments, routing/focus and existing argument-normalization behavior. |
| OS-05 | Login and system integration | Supported open-at-login behavior, preference synchronization, native-theme notifications and OS shutdown. |
| OS-06 | Existing notifications | Inventory actual native/in-app notifications and their routing, actions and dismissal; preserve implemented behavior without introducing a new notification feature. |
| OS-07 | Diagnostic behavior | Existing startup/load/transport logging and error UI remain usable; equivalent diagnostic access does not expose production privileges. Do not add crash upload or automatic process restart without a source contract. |

### Build, packaging, distribution, and testing

| ID | Contract to preserve | Acceptance cases |
| --- | --- | --- |
| BUILD-01 | Source bundling | Existing React, decorators, styles, static resources, workers and extension globals build without runtime Electron imports in shipped components. |
| BUILD-02 | DI registration | New/moved injectables are generated by `pnpm build:di`; Node and browser registration roots load only their intended implementations. |
| BUILD-03 | Environment type checks | Browser/common code does not gain Node dependencies; legacy exception lists only shrink; Rust and sidecar checks cover their new boundaries. |
| BUILD-04 | Developer loop | Defined Tauri/Node startup ordering, frontend reload, backend restart, diagnostics and deterministic cleanup replace Electron-specific launch tooling. |
| PKG-01 | Release target inventory | Enumerate targets actually produced by release workflows and downstream packaging, not every optional electron-builder key; include supported OS/architecture combinations. |
| PKG-02 | Installers and identity | Preserve app IDs, protocol registration, shortcuts/icons, supported installation modes/paths, uninstall behavior and user-data retention. |
| PKG-03 | Resource inclusion | Include correct Node runtime, backend modules, node-pty/helpers, frontend/workers, tools, licenses and assets for the target; reject wrong-architecture binaries. |
| PKG-04 | Signing and trust | macOS hardened runtime/notarization, Windows signing and applicable Linux distribution requirements include the new host, Node runtime and native resources. |
| PKG-05 | Runtime prerequisites | WebView2, WKWebView and WebKitGTK requirements, offline installation behavior and supported OS floors are verified against existing support commitments. A raised floor needs approval. |
| PKG-06 | Existing update behavior | Preserve the existing distribution/update contract. The packaging configuration states that in-app autoupdates are not supported; do not add Tauri updater functionality merely to replace an unused flag. |
| PKG-07 | Electron-free execution | Clean-machine install/start/workflows succeed without Electron, global Node, build toolchains or development dependencies; no hidden Electron sidecar remains. |
| TEST-01 | Existing tests | Preserve business-logic assertions, fix only host-specific harness assumptions, run unit/environment checks and packaged integration scenarios. |
| TEST-02 | Cross-platform automation | Launch packaged Tauri binaries, drive root and cluster views, capture native integration evidence where browser automation is insufficient, and exercise each release target. |
| TEST-03 | Behavior comparison | Same fixtures, inputs, stored profiles and platform conditions produce equivalent UI results, API effects, persisted state and process lifecycle. |
| TEST-04 | Resource and reliability behavior | Repeated open/close/reload, cluster switching, sustained logs/terminal output, failure cleanup, startup readiness and acceptable responsiveness have measured evidence. Do not invent performance gains. |

## Implementation sequence

### Phase A: establish the Electron reference

- Enumerate host imports and globals in main, common, renderer, technical-feature
  packages, extension loading, transitive dependencies and build externals.
- Map every channel, registration, host call, origin, subprocess and data owner to
  the parity IDs above. Include sync/async signatures and failure semantics.
- Capture source and packaged reference behavior using synthetic profiles and
  controlled clusters. Do not inspect or copy private kubeconfigs or credentials.
- Enumerate actual release workflows, installer modes and supported minimum OS
  versions. Resolve downstream package obligations with their owners.
- Record the reference build identity and environment alongside test artifacts.

Exit: every discovered integration has an owner, a parity ID and an executable
comparison scenario or a stated evidence blocker. No implementation gate is
satisfied by a mock alone.

### Phase B: prove host feasibility

- Exercise G-01 through G-10 in isolated, disposable prototypes.
- Decide routing/TLS, extension protocol, sidecar transport and storage bootstrap
  designs from actual platform results.
- Resolve the main-extension Electron guarantee before committing to an
  Electron-free architecture.
- Verify the packaged Node/native dependency combination, not just local Node.

Exit: every gate has a demonstrated implementation path or migration stops for a
scope decision. Do not proceed on the assumption that a compatibility shim will
cover unenumerated APIs.

### Phase C: introduce the Tauri shell and Node backend

- Add the minimum Tauri host, configuration and native capabilities.
- Add a Node backend entry that registers existing backend services using host
  adapters instead of Electron implementations.
- Establish readiness, version/protocol compatibility, logging, parent/child
  ownership, graceful shutdown and failure reporting.
- Launch unchanged domain logic through the new host where it is host-independent.

Exit: lifecycle tests and a clean packaged backend run succeed without an Electron
process. Existing Electron builds remain available as the comparison reference.

### Phase D: port messaging, origins and renderer integration

- Implement both IPC adapter families and extension channel compatibility.
- Implement trusted window/frame registration, local routes and extension assets.
- Remove renderer runtime Node requirements through existing injectable seams or
  narrowly scoped host-access changes.
- Preserve synchronous state initialization before UI/extension consumers start.
- Validate real root/cluster webviews, workers and module imports on every OS.

Exit: IPC, network, persistence bootstrap, editor and frame-isolation acceptance
cases pass in a packaged application.

### Phase E: port native integration and complete workflows

- Replace native menus, tray/dock, dialogs, clipboard, deep links, login integration
  and window state.
- Exercise cluster credentials, tools, PTYs, Helm, logs and resource actions using
  the retained backend implementations.
- Run all extension contract cases, including singleton identity and teardown.

Exit: all application, desktop, terminal/tool and extension obligations pass. A
working main screen is not sufficient.

### Phase F: package, upgrade and retire Electron

- Replace Electron-specific bundling/packaging and automation only where required.
- Validate signed release packages, existing-profile upgrades, offline/runtime
  prerequisites, supported installer modes and downstream distribution contracts.
- Run the complete reference-versus-replacement matrix.
- Remove Electron runtime dependencies, obsolete adapters and Electron-only build
  hooks after the replacement passes. Preserve reference evidence outside shipped
  artifacts.

Exit: no required item is unowned, unknown, unsupported or failing; no shipped path
loads Electron; the documented extension promises remain true.

## Validation and evidence

### Required target matrix

Run on every supported release OS/architecture and applicable minimum webview/OS
version. Establish the exact list from release workflows; do not assume every
possible Rust target is supported.

| Environment | Required cases |
| --- | --- |
| macOS | WKWebView, Intel/Apple Silicon where distributed, menu/dock/activation, login integration, signed/notarized package and packaged automation. |
| Windows | WebView2, distributed architectures, installer/portable modes where supported, shell/PATH/case behavior, PTY helpers, single-instance/deep-link registration. |
| Linux | WebKitGTK, distributed architectures/package formats, X11/Wayland where supported, tray/window behavior, proxy/TLS routing and iframe authorization. |
| Clean machine | No global Node/Electron/toolchain; intended runtime prerequisites only; correct native resources and permissions. |
| Existing profile | Preferences, clusters, extensions and local files from the reference package, with backups and exclusive writer ownership. |
| Network variants | Direct, configured/system proxy, offline, unavailable cluster, expired credentials, certificate failures and interrupted streams/downloads. |
| Locale and paths | Spaces, non-ASCII names, Windows path casing/separators, IME input and supported locale-dependent behavior. |

For each applicable item, include successful and rejected inputs, boundary cases,
cancellation/disposal, repeated activation and teardown. Exercise malformed
manifests/payloads/paths and unauthorized calls where a parser or trust boundary
exists. A disabled test is an evidence gap.

### Reuse existing tests

Existing test anchors include:

- `freelens/integration/__tests__/app-preferences.tests.ts`
- `freelens/integration/__tests__/cluster-pages.tests.ts`
- `freelens/integration/__tests__/command-palette.tests.ts`
- `freelens/integration/__tests__/extensions.tests.ts`
- `packages/core/src/extensions/__tests__/extension-api-declared-values.test.ts`
- `packages/core/src/extensions/__tests__/extension-api-shell.test.ts`
- `packages/core/src/main/shell-session/session-identity.test.ts`
- `packages/core/src/main/cluster/cluster-connection-auth-backoff.test.ts`
- `packages/core/src/main/kubectl/kubectl.test.ts`
- `packages/core/src/main/fetch/download-binary.test.ts`
- `packages/core/src/features/extensions/loader/main/serve-extension-file.test.ts`
- Tests beside the injectable messaging adapters, stores and lifecycle features.

These are starting points, not proof of coverage or passing results. Preserve
business assertions when replacing Electron-specific test harnesses. Extend
packaged tests for native behavior and trust boundaries that mocks cannot prove.

The existing baseline commands are:

```sh
pnpm build:di
pnpm build
pnpm type:check
pnpm test:unit
pnpm build:app:dir
pnpm test:integration
pnpm trunk check
```

Some commands are Electron-specific until their infrastructure is ported. Define
and exercise replacement Rust, sidecar, packaged-launch and integration commands
before retiring their Electron counterparts. Do not present the baseline commands
as existing Tauri validation.

### Evidence requirements per parity item

Record implementation evidence in the migration review and CI artifacts, keeping
this document focused on contracts rather than changing status counts. Each item
needs:

- Parity ID, source anchor, implementation module/adapter and responsible owner.
- Reference and replacement build identities, OS/architecture, webview/Node
  versions, fixtures and exact commands/scenario inputs.
- Expected outcome and observed assertions, including errors and cleanup.
- Relevant UI snapshots, request/response observations, persisted data diffs,
  process/resource cleanup evidence and native OS observations.
- An explicit result for each required target. Non-applicability requires evidence
  that the reference does not support or expose that behavior on that target.

Normalize only irrelevant variability such as temporary paths, ephemeral ports,
process IDs and timestamps. Never normalize away missing messages, changed
permissions, lost fields, different errors, cross-cluster delivery, data loss or
leaked child processes. Preserve required event ordering and do not treat
unordered logs as proof of lifecycle equivalence.

Test recordings must use synthetic credentials or redact secrets. Put temporary
scripts, profiles, logs, screenshots and runtime artifacts outside the repository.

## Change-control and stop rules

Every implementation change must name the Electron dependency it replaces and the
parity ID it satisfies. Keep the UI, domain algorithms and supported extension
surface unchanged except for necessary host-access adaptation.

Stop for an explicit decision when:

- A promised Electron extension API has no compatible replacement.
- A synchronous contract can only be replaced by changing its public semantics.
- A platform cannot preserve origin, certificate or privileged-frame isolation.
- An existing supported package format, architecture, OS floor or install mode
  cannot be retained.
- A proposed workaround retains Electron, requires insecure permissions, changes
  stored data, or adds an unrelated feature.

An approved reduction in scope may produce a useful Tauri application, but it is
not full parity. Do not silently reclassify a blocker as an optional feature.

## Completion checklist

- [ ] Every reachable host dependency and supported release target is enumerated.
- [ ] Every feasibility gate has platform evidence, including the main-extension
  Electron guarantee.
- [ ] Every required parity ID has an implementation owner and passing evidence.
- [ ] Existing domain tests and extension declaration/runtime contracts still pass.
- [ ] Packaged root/cluster workflows pass across the supported platform matrix.
- [ ] Existing data and extension installations survive upgrade without data loss.
- [ ] Privileged IPC, local routes, TLS and extension resources preserve isolation.
- [ ] Node, PTYs and tool processes have verified ownership and cleanup.
- [ ] Installers, signing, protocol registration and runtime prerequisites match
  supported distribution requirements.
- [ ] The application runs without Electron or a globally installed Node runtime.
- [ ] No unrelated refactors, UI changes, features or dependency upgrades are mixed
  into the port.
- [ ] No skipped, unknown or incompatible required behavior is labeled complete.

## Tauri reference documentation

Validate selected APIs against the pinned Tauri/plugin versions before
implementation. Official starting points:

- [Architecture](https://v2.tauri.app/concept/architecture/)
- [Process model and platform webviews](https://v2.tauri.app/concept/process-model/)
- [Asynchronous IPC](https://v2.tauri.app/concept/inter-process-communication/)
- [Frontend commands and return values](https://v2.tauri.app/develop/calling-rust/)
- [Capabilities and remote/iframe access](https://v2.tauri.app/security/capabilities/)
- [External binary packaging](https://v2.tauri.app/develop/sidecar/)
- [Bundling a Node.js sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Packaged WebDriver testing](https://v2.tauri.app/develop/tests/webdriver/)

Native Tauri commands, plugins or custom-protocol support are candidates for host
adapters. Their existence does not establish parity with Electron semantics.
