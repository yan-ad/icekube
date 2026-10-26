<img width="256" height="256" alt="128x128@2x" src="https://github.com/user-attachments/assets/ce02739d-b816-423c-b939-06f690075053" />


# IceKube

[IceKube](https://icekube.yan.ad) is a fast, light, and easy way to manage your Kubernetes cluster easily. It's a supercharged version of FreelensApp

Say goodbye to clunky kube managed experience and don't loose all of your RAM usage for that.

## Why IceKube?
- ⚡️ *Blazing Fast*. It runs in your built in os driver and using Rust as the backend (no node js backend running)
- 👌 *Redefined Looks*. This app is designed for better user experience like modern app did
- 🧱 *Purely Free*. I will never collect money from you to use this app, except you want to buy me a coffee.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

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
