# AGENTS.md

Project-specific guidance for AI coding agents.

## Objective and sources of truth

- Read `DESIGN.md` before UI, navigation, native-window, or architecture changes.
- Build a Kubernetes desktop workspace with Freelens-like user workflows using
  Icekube's existing Astryx design. Freelens is a behavioral reference, not an
  instruction to copy Electron/Node architecture or claim feature parity.
- For each reference workflow, record the upstream version/source, expected
  interaction, Rust owner, UI states, and acceptance test. Preserve relevant
  notices if adapting upstream code. Do not claim extension compatibility.
- Current state: Catalog-first navigation/search, Rust-owned catalog persistence,
  explicit kubeconfig metadata import, built-in default-file discovery, SQLite,
  web links, persisted record colors, individual item pins, and a
  Rust-owned seamless frame. All Categories combines clusters and web links;
  category pages are never pinnable. Explicit Rust-owned HTTPS connections and bounded
  read-only Nodes/Namespaces snapshots are implemented; auth helpers, background watches,
  and mutations are not. Keep disconnected, failed, stale, and partial states honest.
- Cluster rows/pins open an ID-scoped disconnected workspace with inset navigation,
  temporarily auto-collapsing main navigation without overwriting its Catalog
  preference. Do not confuse opening that route with connecting/authenticating.
- Web-link rows/pins open only saved links through Rust `catalog_open_web_link`.
  Keep URLs resolved/validated in Rust; do not add renderer `window.open`, direct
  external networking, or arbitrary opener permissions. Pin/Remove must not trigger
  row activation. Preserve keyboard activation and missing/stale/error states.

## Non-negotiable runtime architecture

- `src-tauri/src/` is the Rust backend engine. Rust owns Kubernetes connections,
  discovery/authentication, kubeconfig and credentials, filesystem/domain
  persistence, watches, subprocesses, proxies, terminals, logs, port forwards,
  metrics, Helm, and native lifecycle.
- `src/` is React/TypeScript presentation running in the system webview. It owns
  routes, rendering, accessibility, ephemeral UI state, and typed IPC adapters.
  Do not put Kubernetes clients, credential handling, host filesystem access,
  or direct cluster networking in the renderer.
- Node/Bun is allowed for frontend dependency management, Vite, build tools, and
  development tests only. The frontend runs as browser JavaScript, not Node.
  Never add a Node server, Electron runtime, JS backend, or Node/Bun sidecar.
- Keep Rust commands thin over engine services. Define serializable request,
  response, and error contracts; validate at the Rust boundary. Scope requests
  and events to cluster/context/namespace, and reject stale cross-session work.
- Every watch/session/process has an owner, bounded output/backpressure, and
  cancellation/cleanup on disconnect, view disposal, and app shutdown.
- Frontend localStorage is only for non-sensitive UI preferences. Secrets,
  kubeconfig, item pins, and durable domain records stay in Rust-managed storage.
  Never log or serialize secrets into renderer events.
- Use least-privilege Tauri capabilities. Do not broaden CSP, shell, filesystem,
  or remote-origin access to work around an implementation bug. Existing starter
  configuration is not evidence that a permissive security setting is safe.

## Design and seamless layout

- Preserve the current section-style shell, single collapsible sidebar, compact
  tables, token spacing, and Astryx theme. Add features inside the existing shell.
- Catalog is home. Do not restore the Welcome screen, separate app rail, or
  category-page pin controls. The toolbar sidebar toggle replaces Home; pinning
  belongs to list entries only. Keep collapsed icons accessible and preserve the
  independent full-width narrow-window drawer and desktop collapse preference.
- Keep category headings visually hidden and omit routine discovery information
  or controls. Place Add config, Add web link, and Refresh beside Search in the
  existing toolbar, using an accessible overflow menu when space is limited.
  Do not suppress real loading, empty, or error states to make the UI look clean.
- All Categories replaces General and shows both entity kinds, not a setup page.
  Preserve the legacy `/catalog/general` redirect. Reference the local `freelens`
  checkout, not `taulens`; record the commit before implementing another workflow.
- Catalog import stays metadata-only until authentication/connection lifecycle
  support is separately approved. Default-file discovery is built in and
  reads only `~/.kube/config` on catalog load/Refresh,
  never `KUBECONFIG` or a directory scan. Never read real kubeconfigs in agent tests,
  execute auth plugins, or claim a context is connected from an import.
- Kubeconfig paths may be symbolic links. Resolve before opening and enforce
  readable regular-file/size limits on the target; retain canonical identity and
  selected-path provenance. Broken/cyclic links must preserve prior records.
  Keep catalog database, lock, sidecar, and legacy-storage symlinks rejected.
- Catalog columns stay Name, Kind, Source, Labels, Status, Actions in every category.
  Kind uses the sidebar's category name/icon; Labels expose file provenance.
  Use Astryx neutral status badges (explicit exception to the count-only rule).
  Per-record random hex colors are Rust-generated data persisted in SQLite, not
  renderer-generated colors or theme palette overrides; preserve them across reloads.
- `seamless` is an Icekube window mode, not an upstream Astryx prop/variant.
  `src-tauri/src/window.rs` owns the flag, native window construction, and initial
  layout metadata; `WindowFrame` owns device insets and `WindowToolbar` owns
  native-control clearance, drag space, and controls in the existing toolbar row.
  Do not add an app-name strip or a second title-bar/navigation row.
- Keep native and renderer mode synchronized from that one Rust source. Keep
  `create: false` for the Rust-created main window; never create a duplicate.
- On macOS retain traffic lights using overlay/hidden-title behavior and reserve
  their physical-left area. On Windows/Linux replace removed decorations with
  working accessible controls. Browser preview and non-seamless mode must not
  render fake desktop chrome or invoke native APIs.
- Reserve safe area once at the frame, including device insets and native-control
  budgets. Pages must not hardcode title-bar padding. Do not rely on CSS device
  insets to measure desktop window controls. Keep controls outside drag targets.
- Recheck narrow windows, internal scrolling, zoom, fullscreen, and window-action
  errors whenever changing chrome. Never claim native OS checks from IPC mocks.
- Do not edit generated `src/astryx-themes.ts` or `node_modules` by hand. The
  unused starter `src/App.css` is not the visual specification. Reset/theme CSS
  imports in the entry are required; avoid additional page-level CSS imports.

## Work and verification

- Inspect relevant files first. Make small changes and test before extending
  scope. Do not refactor unrelated UI or add dependencies without a concrete need.
- Use Bun for frontend commands. Keep dependencies in `package.json`/`bun.lock`
  and Rust dependencies in `src-tauri/Cargo.toml`/`Cargo.lock`.
- Frontend: `bun run build`; `bun run test:e2e` (first setup:
  `bunx playwright install chromium`). Dev preview: `bun run dev`.
- Rust: `cargo fmt --manifest-path src-tauri/Cargo.toml --check`,
  `cargo test --manifest-path src-tauri/Cargo.toml`, and
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- Native smoke test: `bun run tauri dev`. Verify window controls/drag/resize and
  fullscreen on each claimed OS, plus browser fallback, navigation, search,
  item pins when implemented, empty/loading/error states, keyboard focus, and overflow.
- Prefer fixtures and mocked IPC for automation. Never mutate clusters, launch
  exec sessions, open port forwards, or read real credentials without approval.
- Report actual test results and platform limitations. Do not auto-commit.

<!-- ASTRYX:START -->
Astryx v0.7.3 · 173 components
CLI: run every command as `bunx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
