# Historical OS-signed Iceon release tooling

For the current `0.0.3` release, use [the current release workflow](releases.md),
not `cargo xtask release`. That route publishes macOS aarch64 and Windows x86
installers with version-bound updater signatures, without OS signing certificates.
The route documented below is the older macOS-only Developer ID/notarized route;
it does not skip missing secrets and is not the 0.0.3 shipping procedure.
The product is Iceon, with Rust package/executable `iceon`, bundle identifier
`ad.yan.iceon`, and the `yan-ad/iceon` repository.

This older pipeline publishes **macOS aarch64 only**. The install artifact is a DMG. The additional `.app.tar.gz`, `.app.tar.gz.sig`, and `latest.json` assets are required by Tauri's updater, not additional platform installers. It does not build Windows, Intel, Universal or Linux installers. Do not confuse that limitation with the current workflow's Windows x86 route.

## One-time setup

1. This historical route requires `bundle.createUpdaterArtifacts: true`, the real updater public key content in `plugins.updater.pubkey`, and this endpoint in `src-tauri/tauri.conf.json` (already configured for the current route):

   `https://github.com/yan-ad/iceon/releases/latest/download/latest.json`

   This is the Iceon release repository. Do not rename the release repository without deliberately migrating both the tooling and updater configuration. Actual xtask publication refuses other remote URLs.
2. Preserve the existing updater trust key. The current route already embeds its public key and uses a configured GitHub Actions private-key secret. Do not generate a replacement as a routine release step, read signing secrets or commit private keys, passwords, certificates or real kubeconfigs. A replacement private key cannot update installs that trust the old key without a planned migration. This documentation pass did not access private signing material.
3. Obtain a **Developer ID Application** certificate and export its private key as a password-protected `.p12`. Base64-encode the `.p12` for `APPLE_CERTIFICATE`. An Apple Development or ad-hoc identity is not a substitute for a notarized distribution identity.
4. Add these repository secrets (or adapt the workflow to an explicitly protected GitHub Environment):

   | Secret | Value |
   | --- | --- |
   | `TAURI_SIGNING_PRIVATE_KEY` | Content of the Tauri updater private key, not a path on your workstation |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Nonempty password used to encrypt that updater key |
   | `APPLE_CERTIFICATE` | Base64 content of the exported Developer ID Application `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | Nonempty `.p12` export password |
   | `APPLE_SIGNING_IDENTITY` | Exact `Developer ID Application: Name (TEAMID)` identity |
   | `APPLE_ID` | Apple account email for notarization |
   | `APPLE_PASSWORD` | Apple **app-specific** password, not your normal account password |
   | `APPLE_TEAM_ID` | Apple Developer team ID |

   `GITHUB_TOKEN` is supplied automatically by Actions. The release job grants only `contents: write`; no PAT or `KEYCHAIN_PASSWORD` secret is required. Tauri CLI imports the certificate into its temporary keychain. This workflow deliberately requires password-protected signing material, although Tauri also supports unencrypted updater keys. It uses the Apple ID notarization method, not App Store Connect API key secrets.
5. Allow tag-triggered Actions and release creation in repository/organization policy. Protect release branches and `v*` tags. Prefer a reviewed GitHub Environment approval gate if more than one person can push tags. Anyone able to alter the workflow in a trusted release tag can access its secrets. Review the pinned action and dependency changes before granting that trust.
6. Install Rust, Git and Bun 1.4.2 locally; run `bun install --frozen-lockfile` before releasing to populate the offline cache. Ensure Git commit/tag identity and any configured signing agent are ready. Release checks never prompt for remote credentials; configure SSH/HTTPS authentication in advance. Do not place tokens in remote URLs.

## Run a release

```sh
# Local inspection only. Choose the intended branch explicitly if it is not main.
cargo xtask release patch --dry-run --branch main
cargo xtask release 0.2.0 --dry-run --branch main

# Publishes after validation. This command is intentionally not a dry run.
cargo xtask release patch --branch main
```

`minor`, `major`, or a canonical stable `X.Y.Z` are accepted. Prereleases and build metadata are intentionally rejected because the endpoint follows the latest stable release. `--remote` defaults to `origin`; `--branch` defaults to `main`. On this checkout the development branch was `super` during implementation, so the default branch guard will refuse it. Do not bypass the guard casually: merge reviewed work to your chosen release branch first. Its upstream must be the selected remote's same-name branch.

The xtask:

- Requires a clean tracked/untracked working tree and index, a named branch, exactly one matching fetch/push URL, matching upstream and a locally known upstream ancestor. Detached HEAD, mismatched versions, unsupported lock formats/workspaces and symlinked version files are rejected.
- Checks `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, the local application entry in `src-tauri/Cargo.lock`, and root metadata in `bun.lock`. Bun normally omits the root version; when present it is checked and bumped. `xtask/Cargo.lock` locks release-tool dependencies and its independent package version does not track the app.
- On an actual run, validates updater configuration, fetches the branch without force, checks upstream ancestry again and checks remote tag absence. Local commits ahead of upstream are intentionally included. Review them first. It never force-pushes and requires the server to support atomic push.
- Computes edits before writing, updates only the version-file allowlist, runs offline frozen Bun installation with lifecycle scripts disabled and offline locked Cargo metadata validation, stages only explicit paths, creates `chore(release): vX.Y.Z`, creates an annotated `vX.Y.Z` tag and atomically pushes branch plus tag. It does not run app builds or cluster tests locally; run those before releasing.
- Bounds each child command to 120 seconds and caps captured output to 1 MiB per stream. Git output is not echoed because hooks/URLs may contain secrets. Git hooks and installed Git/Bun/Cargo executables are trusted local code, not sandboxed code. Do not concurrently edit, stage, commit or change branches while it runs.

`--dry-run` invokes only local read-only Git checks and computes version edits in memory. It deliberately skips remote freshness/collision checks and signing/build checks. It neither fetches nor invokes Bun. **The outer `cargo` invocation can still compile xtask and download its dependencies on first use**, so prebuild it with the checked-in lockfile if you need a fully offline shell session. No application version is modified by a dry run.

## What Actions does

A pushed `v*` tag starts the historical `.github/workflows/release.yml`. It checks tag/version agreement with `cargo xtask verify-release`, validates the real updater configuration and required secrets, installs frozen Bun dependencies, tests xtask, and builds on `macos-15` with an explicit `arm64` host assertion and only `aarch64-apple-darwin` Rust target. Tauri receives `--bundles dmg` plus Cargo `--locked`; it signs, notarizes and staples through the standard CLI path. `verify-release` still expects a `v`-prefixed stable tag and configured updater key/artifacts; it is not the current exact `0.0.3` no-`v` workflow guard. The current route uses `verify-update` for package signatures and authenticated versions on both platforms.

The pinned Tauri v0 action creates an exact-tag **draft** release and uploads the DMG, signed updater archive/signature and generated `latest.json`. A follow-up step checks the exact asset set, tag/version, aarch64-only manifest entries (both `darwin-aarch64` and v0's `darwin-aarch64-app` alias), exact-tag download URL, and equality with the uploaded signature. Only then does it publish and mark the release latest. No plain executable is uploaded. GitHub supplies source-code archives independently.

Keep releases monotonic. Do not re-run older tags after newer releases or manually mark an older release latest. Concurrency serializes release jobs but is not a semantic-version ordering mechanism. Test installation and actual signed update behavior on a real Apple Silicon Mac before announcing a release; these checks cannot prove Gatekeeper acceptance or updater installation behavior.

## Failure and recovery

The tool never auto-resets your tree or deletes a tag. A validation/write/tool/hook failure can leave edited/staged files. A commit/tag/push failure can leave a local commit or tag. Inspect `git status`, `git log` and local/remote refs. A network timeout can have an uncertain remote result; inspect GitHub before retrying. If the exact local release commit/tag already exists and remote refs are absent, an operator can retry the exact atomic push after review instead of bumping again. Never force-push or retarget a published version.

A failed CI build leaves the tag and possibly a draft release, not a successful release. Fix missing secrets or transient infrastructure and re-run the same workflow when source is unchanged. Source changes require a new version. Review stale draft assets before retrying; the post-build guard refuses to publish unexpected assets or to overwrite a release that is already published. Do not delete updater artifacts from successful releases while users may still need them.

## Verification and sources

Implementation verification uses isolated temporary Git repositories with fake unreachable remotes. It does not push anything. No real commit, tag, release, certificate import, notarization or updater install was performed in the product repository during implementation.

```sh
cargo fmt --manifest-path xtask/Cargo.toml --check
cargo test --manifest-path xtask/Cargo.toml --locked
cargo clippy --manifest-path xtask/Cargo.toml --all-targets --locked -- -D warnings
```

Official sources reviewed on 2026-10-26:

- [Tauri v2 GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri v2 updater signatures, artifacts and static manifest](https://v2.tauri.app/plugin/updater/)
- [Tauri v2 macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri action v0 inputs](https://github.com/tauri-apps/tauri-action/blob/84b9d35b5fc46c1e45415bdb6144030364f7ebc5/action.yml) and [manifest implementation](https://github.com/tauri-apps/tauri-action/blob/84b9d35b5fc46c1e45415bdb6144030364f7ebc5/src/upload-version-json.ts)

The current general pipeline guide recommends v1. The requested v0 line was checked separately: GitHub's `refs/tags/v0` API resolved its annotated tag to commit `84b9d35b5fc46c1e45415bdb6144030364f7ebc5`, which this workflow pins. Review and test that pin deliberately when upgrading.
