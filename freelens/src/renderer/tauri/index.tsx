/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "../../../../packages/core/src/renderer/components/app.scss";
import "../../../../packages/ui-components/icon/src/icon.scss";

import { createContainer } from "@ogre-tools/injectable";
import { createRoot } from "react-dom/client";
import darkTheme from "../../../../packages/core/src/renderer/themes/lens-dark.injectable";
import lightTheme from "../../../../packages/core/src/renderer/themes/lens-light.injectable";
import { type RuntimeHost, type RuntimeStatus, TauriApplication } from "./app";

interface TauriWindow extends Window {
  __TAURI__?: { core: { invoke: <T>(command: string) => Promise<T> } };
}

const invoke = <T,>(command: string): Promise<T> => {
  const api = (window as TauriWindow).__TAURI__;
  return api ? api.core.invoke<T>(command) : Promise.reject(new Error("Tauri host is unavailable"));
};

const host: RuntimeHost = {
  status: () => invoke<RuntimeStatus>("runtime_status"),
  ready: () => invoke<void>("runtime_ready"),
};

const di = createContainer("tauri-renderer");
di.register(darkTheme, lightTheme);
const preference = matchMedia("(prefers-color-scheme: light)");
const applyTheme = () => {
  const theme = di.inject(preference.matches ? lightTheme : darkTheme);
  for (const [name, value] of Object.entries(theme.colors)) {
    document.documentElement.style.setProperty(`--${name}`, value);
  }
  document.body.classList.toggle("theme-light", theme.type === "light");
};

applyTheme();
preference.addEventListener("change", applyTheme);

const element = document.getElementById("app");
if (!element) throw new Error("Freelens application root is missing");

createRoot(element).render(<TauriApplication host={host} />);
