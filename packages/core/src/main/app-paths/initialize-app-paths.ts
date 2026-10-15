/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { pathNames } from "../../common/app-paths/app-path-names";

import type { AppPaths } from "../../common/app-paths/app-path-injection-token";
import type { PathName } from "../../common/app-paths/app-path-names";

export interface AppPathHost {
  getPath(name: PathName): string;
  setPath(name: PathName, path: string): void;
}

interface InitializeAppPathsOptions {
  host: AppPathHost;
  appName: string;
  directoryForIntegrationTesting: string | undefined;
  joinPaths(...paths: string[]): string;
}

export const initializeAppPaths = ({
  host,
  appName,
  directoryForIntegrationTesting,
  joinPaths,
}: InitializeAppPathsOptions): AppPaths => {
  if (directoryForIntegrationTesting) {
    host.setPath("appData", directoryForIntegrationTesting);
  }

  const appDataPath = host.getPath("appData");

  host.setPath("userData", joinPaths(appDataPath, appName));
  host.setPath("sessionData", host.getPath("userData"));

  return Object.fromEntries(pathNames.map((name) => [name, host.getPath(name)])) as AppPaths;
};
