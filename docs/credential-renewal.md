# Credential renewal

## Source and scope

This contract describes Iceon source, not a claim of provider compatibility or
Freelens parity. Owners are `src-tauri/src/connection/config.rs`, `auth.rs`,
`renewal.rs` and the session lifecycle in `src-tauri/src/connection.rs`.
React receives typed public results, not credentials. No upstream implementation
was copied for this documentation.

Only the selected user's configured exec helper or token file is renewable.
`config.rs::build_client_owned` prepares the selected context/cluster/user,
retains that configuration snapshot, resolves initial credentials, materializes
an HTTPS client and wraps eligible sources with `renewal.rs::wrap`. The lease
retains the prepared configuration and canonical source directory. Renewal does
not reread the whole kubeconfig or discover new users, commands or contexts.
Reconnect is required to adopt configuration changes.

## Request-time behavior

- A shared lease holds the current client, generation and last renewal failure
  behind a Tokio `Mutex`. Cloned client handles share this lease. Concurrent
  renewal is serialized; a request rejected with an older generation can reuse
  the newly installed generation instead of rerunning the helper.
- Before a new request, a known expiry within **30 seconds** triggers renewal.
  Token files have no parsed expiry, so their rotation is picked up through an
  eligible unauthorized read, not a background polling timer. Exec credentials
  without reported expiry likewise rely on an eligible 401 response.
- An HTTP **401** can trigger renewal and **one** replay of a cloneable **GET or
  HEAD**. The replay is sent directly once; a second 401 is not recursively retried.
  If renewal fails, the request fails without replay. Other HTTP errors do not
  trigger this retry.
- Mutations are never replayed. Requests with an Upgrade header or an `exec`,
  `attach` or `portforward` path component are excluded even when they use GET.
  Such requests may use proactively renewed credentials before their first send,
  but a 401 does not authorize a second session-opening attempt.
- A renewal failure is shared for a **5-second backoff** when renewal is needed,
  preventing waiting requests from repeatedly launching the same failing helper.
  This is not an autonomous retry loop or a guarantee of eventual recovery.

## Bounds and disposal

`auth.rs::resolve_tracked` invokes only the selected configured exec helper,
non-interactively, with validated argument/environment and ExecCredential
contracts. It does not invent provider commands, invoke a shell to interpret a
command string, or run arbitrary Kubernetes commands. Installing/configuring an
exec helper is still a trust decision: the configured executable runs with the
user's permissions.

### macOS application launches and helper lookup

Finder/Dock launches do not inherit the login shell's PATH. For configured exec
helpers, Iceon preserves an explicit `exec.env` entry named `PATH` exactly. If no
such entry exists, only the helper child receives a bounded PATH: inherited
absolute directories first, followed by Homebrew's `/opt/homebrew/bin` and
`/usr/local/bin`, fixed Google Cloud SDK `bin` locations under Homebrew and
`~/google-cloud-sdk` / `~/.local/share/google-cloud-sdk`, and standard system
directories. Empty, relative and duplicate inherited entries are omitted.
Lookup is capped at 128 directories / 32 KiB. Absolute commands remain absolute;
relative commands with path separators stay relative to the canonical kubeconfig
directory. Both initial exec authentication and renewal use this behavior. Bare
commands without an explicit kubeconfig PATH are resolved to the first canonical,
regular executable in this child PATH before spawning. Explicit PATH lookup is
left to process spawning, preserving its search order, including relative entries;
explicit path-containing commands are not substituted.

If the initial spawn still reports NotFound, automatic fallback reads bounded
literal PATH entries from `/etc/paths` and up to 32 regular files in
`/etc/paths.d`. Only for `gke-gcloud-auth-plugin` or `gcloud`, it also recognizes
literal SDK source declarations in `.zshrc`, `.zprofile`, `.bashrc`,
`.bash_profile`, and `.profile`. Fish hints come from `config.fish`, saved
`fish_user_paths` in `fish_variables`, and up to 32 entries in `conf.d` (only
`.fish` files are read), under `$XDG_CONFIG_HOME/fish` when that inherited setting
is absolute, otherwise `~/.config/fish`. Recognized fish declarations are literal
`source …/google-cloud-sdk/path.fish.inc`, `fish_add_path …/google-cloud-sdk/bin`,
and `set` assignments to `PATH` or `fish_user_paths`, including
`set -gx PATH "$HOME/Kerjaa/google-cloud-sdk/bin" $PATH`. Saved universal paths
decode fish's hexadecimal escapes and list separators without evaluating them.
These declarations can identify a custom
`google-cloud-sdk` installation, including paths containing spaces. They are
never executed: only the SDK's `bin` path is extracted. Unrecognized shell
expressions, command substitution, parent traversal, and symlinked hint files
are rejected. Reads are capped at 8 KiB per file and 32 KiB total. Discovery and
the fallback spawn share the helper supervisor's original deadline and
cancellation. New paths are adopted only if the exact configured helper exists.
Fish is treated as a source of SDK installation hints, not a shell interpreter:
dynamic expressions, functions and conditional execution are not reproduced.
An unsaved PATH change in a terminal cannot be recovered by a Finder-launched
app. A persisted literal declaration or saved `fish_user_paths` is required for
custom SDK locations outside the fixed defaults. Fixture tests in
`connection/auth_fish.rs` and `connection/auth_path.rs` cover fish discovery,
minimal app-launch PATH, sibling CLI execution, XDG configuration, unsupported
syntax, bounded reads, cancellation, and unchanged explicit kubeconfig PATH.

The app does not evaluate shell startup files, invoke a login shell, recursively
search the filesystem, install tools, run legacy provider `cmd-path`, or change
its global environment. Helper arguments, credentials and ExecCredential output never enter
renderer diagnostics. Explicit kubeconfig environments and installed executables
remain user-controlled trust boundaries; this is not executable identity pinning.

For an installed build without this lookup support, use Terminal's
`command -v gke-gcloud-auth-plugin` (or the configured helper's name) to find its
absolute path. Set that path as the selected user's `exec.command`, or provide an
explicit `exec.env` PATH, then re-import corrected metadata if the source changed
and reconnect. No path output means the helper must be installed separately.

Helpers have a 15-second deadline, bounded stdout (1 MiB) and stderr (64 KiB),
with token and PEM bounds enforced before credentials are installed. Token-file
reads resolve the configured path beside the canonical source, canonicalize it,
and use a bounded regular-file read (64 KiB). Tokens/output are not returned as
renderer errors. Renewal materializes the same selected prepared configuration;
TLS verification and existing transport constraints remain in force.

The lease is cancellation-scoped to its session. Each send also observes its
request cancellation token; cancellation while waiting for the mutex cannot later
publish a request result. Refresh is bounded by the connection deadline. Dropping
a helper await signals an independently tracked supervisor, which kills and reaps
the process group/job rather than abandoning a worker. Session disconnect/shutdown
owns cancellation and tracked cleanup. This is bounded owned work, not a detached
background credential daemon.

## Exclusions

- Static token/basic/client-certificate credentials do not automatically refresh.
- Supported cached legacy auth-provider credentials remain cache-only; the lease
  does not run provider refresh commands or promise automatic refresh for them.
- Helm has separate subprocess/configuration handling. This client lease does not
  establish Helm credential-renewal support.
- Already established logs, watches, exec/attach and forwarding streams are not
  restarted or reauthenticated by replacing the client generation. Their existing
  failure/cancellation behavior still applies; later requests may use a new client.
- Renewal is not a credential editor, arbitrary kubeconfig rereader, interactive
  login flow or permission escalation. A successful version probe/renewal does not
  establish permission to read every resource.

## Acceptance and verification

Source mapping, not a claim that tests have been rerun in this documentation pass:

| Obligation | Fixture source / test |
| --- | --- |
| Concurrent expiry installs one generation | `connection/renewal_tests.rs::concurrent_expired_reads_install_one_fresh_generation_without_network` |
| One unauthorized-read retry and failure without replay | `unauthorized_read_refreshes_once_and_does_not_replay_if_refresh_fails` |
| No mutation/session-upgrade replay | `replay_excludes_mutations_and_session_upgrades`, `unauthorized_mutation_is_sent_once_without_refresh` |
| Shared failure backoff, old-generation reuse | `concurrent_failures_share_refresh_backoff_without_credentials_in_error`, `rejected_old_generation_reuses_successful_refresh` |
| Disconnect rejects work and cancels waiting refresh | `disconnect_rejects_even_unexpired_client`, `waiting_refresh_is_cancelled_on_disconnect` |
| Selected source only | `connection/auth_tests.rs::selected_token_file_is_reread_without_exec_or_provider`, `renewal_reuses_only_selected_configured_exec_helper` |
| Output/expiry contracts and owned helper cleanup | `connection/auth_tests.rs` parsing, expiry, bounded-output and process-supervision fixtures |

All paths in the table are relative to `src-tauri/src/`. Tests use synthetic
configuration, temporary token files, fixture helpers and in-memory services,
not real credentials or production clusters. Latest status (2026-10-26): full
build/browser/Rust/fmt/strict-Clippy validation is pending. Older 619-browser and
216-Rust totals in [workspace UI reference](workspace-ui-reference.md) remain a
historical checkpoint, not proof of these changes. No native Tauri invocation,
real-provider authentication or native smoke test was performed here.
