/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { startApplicationInjectionToken } from "@freelensapp/application";
import { createContainer, type DiContainer } from "@ogre-tools/injectable";
import { registerMobX } from "@ogre-tools/injectable-extension-for-mobx";
import { runInAction } from "mobx";

export interface RendererBootstrapOptions {
  environment?: string;
  // The host owns feature composition, including applicationFeature and adapters.
  register: (di: DiContainer) => void;
}

/**
 * Initialize DI and invoke the real application lifecycle after host registration.
 * This module must remain browser-safe: host feature trees belong in the entries.
 */
export function initializeRenderer({ environment = "renderer", register }: RendererBootstrapOptions) {
  const di = createContainer(environment);

  // Production lifecycle injectables may perform side effects.
  di.permitSideEffects();

  runInAction(() => {
    registerMobX(di);
    register(di);
  });

  const startApplication = di.inject(startApplicationInjectionToken);
  const started = startApplication();

  // Deliberately synchronous: Electron publishes its extension singletons after
  // start is invoked, not after the asynchronous lifecycle has finished.
  return { di, started };
}
