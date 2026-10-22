/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "../../../../packages/core/src/renderer/components/app.scss";
import "../../../../packages/ui-components/icon/src/icon.scss";

import { applicationFeature, onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { registerFeature } from "@freelensapp/feature-core";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { createRoot } from "react-dom/client";
import darkTheme from "../../../../packages/core/src/renderer/themes/lens-dark.injectable";
import lightTheme from "../../../../packages/core/src/renderer/themes/lens-light.injectable";
import { initializeRenderer } from "../bootstrap";
import { TauriApplication } from "./app";
import { createRuntimeHost, tauriRequester } from "./host";

const mountApplication = getInjectable({
  id: "mount-tauri-application",
  injectionToken: onLoadOfApplicationInjectionToken,
  instantiate: (di) => ({
    run: () => {
      const preference = matchMedia("(prefers-color-scheme: light)");
      document.body.classList.toggle("is-mac", /Mac/.test(navigator.platform));
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

      createRoot(element).render(
        <TauriApplication host={createRuntimeHost(di.inject(requestFromChannelInjectionToken))} />,
      );
    },
  }),
});

const { started } = initializeRenderer({
  environment: "tauri-renderer",
  register: (di) => {
    // Only host-neutral lifecycle and the narrow Tauri UI composition belong
    // here; registerLensCore imports the Electron renderer feature tree.
    registerFeature(di, applicationFeature);
    di.register(darkTheme, lightTheme, tauriRequester, mountApplication);
  },
});

void started.catch((error: unknown) => {
  const element = document.getElementById("app");
  if (element) {
    element.setAttribute("role", "alert");
    element.textContent = `Freelens startup failed: ${String(error)}`;
  }
  console.error("Freelens startup failed", error);
});
