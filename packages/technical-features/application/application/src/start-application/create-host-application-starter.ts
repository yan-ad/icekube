/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { StartApplication } from "./start-application.injectable";

export interface HostApplicationStartup {
  beforeAnything(): void;
  beforeHostIsReady(): void;
  whenHostIsReady(): Promise<unknown>;
  startApplication: StartApplication;
}

export const createHostApplicationStarter = ({
  beforeAnything,
  beforeHostIsReady,
  whenHostIsReady,
  startApplication,
}: HostApplicationStartup): StartApplication => {
  return () => {
    // These hooks configure the host before readiness and must throw synchronously.
    beforeAnything();
    beforeHostIsReady();

    return (async () => {
      await whenHostIsReady();

      return startApplication();
    })();
  };
};
