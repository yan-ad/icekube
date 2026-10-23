# Scripts

Repository scripts that the build, the checks or a developer run directly.

## run-tauri.mjs

Builds the isolated Node bootstrap and browser-only launcher/Catalog frontend,
then runs the Tauri development host. The Catalog snapshot uses the existing
built-in application providers and read-only local kubeconfig context discovery.
Discovery scans immediate files under `~/.kube`; discovery never executes auth
plugins or starts connections. Test, smoke and backend-check modes use synthetic
temporary kubeconfigs instead of the real home directory. The host uses a
temporary profile and does not start cluster services or load extensions. Frontend assets and the profile are built
outside the working tree. The browser build rejects Node and Electron imports.
See [the migration guide](../TAURI_MIGRATION.md#catalog-comparison-boundary)
for prerequisites, limitations and the smoke-test commands.

```sh
pnpm dev:tauri
pnpm check:tauri
pnpm test:tauri
pnpm smoke:tauri
```

`tauri-backend.test.mjs` tests the built backend through real child-process pipes;
run it through `test:tauri` so its bundled entry and temporary profile are supplied.
`tauri-frontend.test.mjs` tests the compiled browser entry, its assets, themes,
startup failures, real backend Catalog snapshots, navigation/search and
rendering-before-readiness ordering through the same command. The native smoke
test traverses Welcome, Catalog and the Pods page before exiting.

Opening a cluster renders the built-in sidebar and read-only Pods view. Load Pods
explicitly authorizes the selected context's normal Kubernetes client authentication,
including any configured exec plugin, followed by bounded Pod GET requests. The
worker is built separately and supervised outside the repository. Discovery never
authenticates. Native smoke traverses to Pods but does not authorize a request;
protocol tests use a loopback Kubernetes fixture rather than a real cluster.

## generate-explicit-di-registration.mjs

Generates the `register-injectables.ts` files that register every injectable
with the dependency-injection container.

```bash
pnpm build:di
```

Run it after adding, moving or renaming an injectable file. The build runs it
too. See "Dependency Injection System" in `AGENTS.md` for how the generated
files are organised.

## type-check-environments.mjs

Runs the main and renderer type-check programs and counts only the errors in
each program's own files.

```bash
pnpm type:check:environments
```

`type-check-environments/` holds the legacy lists and the expected-failure
files the check uses. See "Runtime Environments in Type-Checking" in
`AGENTS.md`.

## vite-plugin-standard-decorators.mjs

A Vite plugin that lowers standard decorators, which MobX 7 requires and Oxc
passes through. `freelens/electron.vite.config.ts` and `vitest.config.ts` load
it.

## knip-install-missing-packages.sh

Adds every package that knip reports as unlisted to the dependencies, and as
development dependencies the ones it reports outside production code.

```bash
scripts/knip-install-missing-packages.sh
```

Review the resulting `package.json` changes before committing them.
