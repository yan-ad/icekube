<img width="64" height="64" alt="branding" src="https://github.com/user-attachments/assets/731a88cd-19d2-470b-9649-e990e11d259c" />


# IceKube

[IceKube](https://icekube.yan.ad) is a fast, light, and easy way to manage your Kubernetes cluster easily. It's a supercharged version of FreelensApp

Say goodbye to clunky kube managed experience and don't loose all of your RAM usage for that.

## Why IceKube?
- ⚡️ *Blazing Fast*. It runs in your built in os driver and using Rust as the backend (no node js backend running)
- 👌 *Redefined Looks*. This app is designed for better user experience like modern app did
- 🧱 *Purely Free*. I will never collect money from you to use this app, except you want to buy me a coffee.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Resource selection and deletion

Kubernetes resource tables have row checkboxes and a select-all checkbox for the
displayed page. The selection count and Clear selection appear in the filter row.
Selection resets when you change filters, pages, namespaces, or workspace sessions;
it never selects unseen continuation pages. Rows without safe UID/version metadata
cannot be selected.

Delete sits at the bottom right, immediately beside Create. Review the selected
names, cluster, and context in its confirmation dialog before submitting. Rust
checks each resource's UID and version again and deletes resources one at a time
with Kubernetes preconditions. Successful requests are deselected; failures remain
visible in the results. An accepted deletion can still be waiting for grace periods
or finalizers. Stop cancels pending work, not deletions already sent to the server;
known results are retained, and accepted targets stay deselected. Refresh before
retrying an uncertain result. Loading, failed, or non-syncing live inventory cannot
start a deletion; becoming stale invalidates an open confirmation.

This applies to the 41 allowlisted Kubernetes resource kinds. Helm uninstall and
local port-forward stop/remove are separate workflows, not generic resource deletes.
Automated coverage uses synthetic objects and mocked IPC; it does not establish
real-cluster success or native window behavior.

Create opens YAML creation on Kubernetes tables, Install opens chart installation
on both Helm pages, and Create port forward opens the namespace/Pod/ports form.
These actions sit at the bottom right; Refresh and Live sync remain in Cluster
actions. Resource creation and Helm installation require server dry-run followed
by confirmation. Opening a dialog alone does not submit a mutation.

## Standalone React DevTools (development only)

Icekube can opt into the standalone React DevTools bridge for local React 19
webview development. It is disabled by default: ordinary `bun run dev`, Tauri
builds, and production assets do not inject the bridge or include it in the
frontend bundle. CSP and Tauri capabilities are unchanged.

In one terminal, start the official `react-devtools` package (version `8.0.0`,
checked against the npm registry on 2026-10-26):

```sh
bun run devtools
```

In another terminal, opt into the Vite bridge:

```sh
bun run dev:inspect
```

For the Tauri development webview, use `bun run tauri:inspect` instead. The
opt-in injects `http://127.0.0.1:8097` at the beginning of `<head>` before the
React module is evaluated. These Bun scripts set `ICEKUBE_REACT_DEVTOOLS=1`;
only that exact value enables injection, and only while Vite serves development
HTML. Start DevTools first, then reload the browser/webview after connecting or
restarting it. If DevTools is not running, the script request fails and inspection
is unavailable; ordinary development can continue without the opt-in.

`bun run devtools` fixes the listener to loopback `127.0.0.1:8097`. Stop the
DevTools window/process when finished, and restart normal development without
the opt-in to remove the bridge. Neither `dev:inspect` nor `tauri:inspect`
automatically starts a listener. `bun run dev` makes no DevTools requests unless
you explicitly supply the opt-in environment variable.

Standalone DevTools uses its own Node/Electron development-tool process. It is
not Icekube's runtime, backend, or a packaged sidecar. Node must be installed to
run the upstream launcher; Bun manages the local dev dependency. Do not inspect
real credentials or cluster sessions: DevTools can inspect component props/state.
This setup does not grant permissions or relax CSP; platform webview/security
restrictions may prevent a connection. Native webview inspection must be checked
on each target OS rather than inferred from browser HTML tests.

This follows the official React standalone guidance:
[`react.dev/learn/react-developer-tools`](https://react.dev/learn/react-developer-tools)
and the [`react-devtools` npm package](https://www.npmjs.com/package/react-devtools).

## References
- [Freelens.app](https://github.com/freelensapp/freelens) The app reference to how this project was made of
- [Tauri](https://github.com/tauri-apps/tauri) This how's we made the app possible
- [Astryx](https://astryx.atmeta.com/) Ui component this project was made of
