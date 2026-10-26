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
frontend bundle. No CSP or Tauri capability changes are required.

In one terminal, start the official `react-devtools` package (currently pinned
to `8.0.0`):

```sh
bun run devtools
```

In another terminal, opt into the Vite bridge:

```sh
bun run dev:inspect
```

For the Tauri development webview, use `bun run tauri:inspect` instead. The
opt-in injects `http://127.0.0.1:8097` at the beginning of `<head>` before the
React module is evaluated. Stop the DevTools process when finished.

This follows the official React standalone guidance:
[`react.dev/learn/react-developer-tools`](https://react.dev/learn/react-developer-tools)
and the [`react-devtools` npm package](https://www.npmjs.com/package/react-devtools).

## References
- [Freelens.app](https://github.com/freelensapp/freelens) The app reference to how this project was made of
- [Tauri](https://github.com/tauri-apps/tauri) This how's we made the app possible
