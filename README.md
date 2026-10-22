# TauLens

A Freelens-based Kubernetes app that aims to use less memory by ditching Electron
for Tauri.

TauLens builds on Freelens to bring a modern Lens-style desktop experience with a
smaller memory footprint. The rewrite targets **Tauri** for the desktop shell,
**Bun** for backend services, and **Astryx UI** for the interface.

Lower memory usage is an engineering goal, not a benchmark claim. We will measure
it against Freelens using comparable workloads, including the host, backend, and
webview processes.

## Apple Silicon first

**macOS on Apple Silicon is the primary MVP target.** Development, testing, and
performance work will focus on Apple Silicon Macs first.

After the Apple Silicon MVP, we plan to cover other desktop platforms, including
Intel Macs, Windows, and Linux. Each platform needs its own packaging, integration
tests, and performance validation before we claim support.

## Engine rewrite objectives

### Tauri desktop shell

Replace Electron with [Tauri](https://v2.tauri.app/start/) and use the system
webview instead of bundling Electron's Chromium runtime. Keep native window
management and operating-system integration separate from application services.

### Bun backend

Port backend services to [Bun](https://bun.com/) while preserving Kubernetes
workflows and user data. Validate cluster connections, authentication helpers,
filesystem access, child processes, terminal sessions, and extension integration
against the new runtime.

### Astryx UI

Rebuild the interface with [Astryx UI](https://astryx.atmeta.com/docs/core) for a
more modern React-based Kubernetes workspace. Use consistent components,
keyboard-accessible navigation, and clear loading and error states.

Support the memory-efficiency goal through careful state management and
rendering. A component-library change alone does not guarantee lower memory use.

## Roadmap

- Establish the Tauri desktop runtime on Apple Silicon.
- Port backend services to Bun and verify core Kubernetes workflows.
- Rebuild the interface with Astryx UI.
- Validate the Apple Silicon MVP, including startup, cluster interactions,
  shutdown, and total application memory usage.
- Expand platform coverage after the Apple Silicon MVP.

## Development

The repository contains Electron-era code alongside the Tauri migration. The
Tauri development path uses a Node.js backend bootstrap; Bun and Astryx UI are
rewrite objectives, not requirements for that development path.

See [DEVELOPMENT.md](DEVELOPMENT.md) for repository setup and
[TAURI_MIGRATION.md](TAURI_MIGRATION.md) for the Node-backed Tauri migration plan
and validation commands. That plan covers the runtime migration, not the broader
Bun and Astryx UI rewrite described here.

With repository dependencies, Node.js, and the Rust toolchain installed, follow
the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), then
run:

```sh
pnpm dev:tauri
```

Validate the Tauri development runtime with:

```sh
pnpm check:tauri
pnpm test:tauri
pnpm smoke:tauri
```

Existing `freelens/` directories and `@freelensapp/*` package names reflect the
upstream foundation. Freelens installers and package-manager entries install
Freelens, not TauLens.

## Contributing

Contributions should focus on the Apple Silicon MVP, runtime compatibility,
Kubernetes workflows, the UI rewrite, and reproducible memory measurements.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the inherited contribution guidelines.
Check runtime and extension compatibility explicitly rather than assuming that
Electron or Node.js integrations carry over unchanged.

## Authors and acknowledgments

TauLens project work is credited to **TauLens Authors**.

TauLens is based on **Freelens**, with its **OpenLens** heritage. We retain the
upstream authors' copyright notices and acknowledge their Kubernetes management,
extension, and desktop application work.

The upstream Freelens README credits Roberto Bandini, Piotr Roszatycki, Mario
Offertucci, Leopoldo Capuano, Omar Alani, and Matías Roje. These are upstream
credits, not a list of TauLens maintainers.

## License

TauLens is licensed under the [MIT License](LICENSE).

Its upstream foundation is Freelens, a fork of OpenLens, the open-source core of
Lens Desktop.

Copyright (c) 2026-Present TauLens Authors.

Copyright (c) 2024-2026 Freelens Authors.

Copyright (c) 2022 OpenLens Authors.

Preserve the copyright and permission notices when distributing this software or
substantial portions of it. See [LICENSE](LICENSE) for the complete terms and
warranty disclaimer.
