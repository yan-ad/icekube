/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { posix, win32 } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pathNames } from "../../common/app-paths/app-path-names";
import { initializeAppPaths } from "./initialize-app-paths";

import type { AppPaths } from "../../common/app-paths/app-path-injection-token";
import type { PathName } from "../../common/app-paths/app-path-names";

const createHost = (appData: string) => {
  const paths = Object.fromEntries(pathNames.map((name) => [name, `existing-${name}`])) as AppPaths;

  paths.appData = appData;

  return {
    paths,
    getPath: vi.fn((name: PathName) => paths[name]),
    setPath: vi.fn((name: PathName, path: string) => {
      paths[name] = path;
    }),
  };
};

describe("initializeAppPaths", () => {
  it.each([
    { appData: "/existing profile/資料", joinPaths: posix.join, expected: "/existing profile/資料/Freelens" },
    { appData: "C:\\Existing Profile\\資料", joinPaths: win32.join, expected: "C:\\Existing Profile\\資料\\Freelens" },
  ])("preserves the existing profile policy for $appData", ({ appData, joinPaths, expected }) => {
    const host = createHost(appData);
    const original = { ...host.paths };
    const result = initializeAppPaths({
      host,
      appName: "Freelens",
      directoryForIntegrationTesting: undefined,
      joinPaths,
    });

    expect(host.setPath.mock.calls).toEqual([
      ["userData", expected],
      ["sessionData", expected],
    ]);
    expect(result).toEqual({ ...original, userData: expected, sessionData: expected });
    expect(Object.keys(result)).toEqual(pathNames);
  });

  it("redirects appData before resolving the integration profile", () => {
    const host = createHost("/original");
    const result = initializeAppPaths({
      host,
      appName: "Freelens",
      directoryForIntegrationTesting: "/isolated",
      joinPaths: posix.join,
    });

    expect(host.setPath.mock.calls).toEqual([
      ["appData", "/isolated"],
      ["userData", "/isolated/Freelens"],
      ["sessionData", "/isolated/Freelens"],
    ]);
    expect(result.appData).toBe("/isolated");
    expect(result.userData).toBe("/isolated/Freelens");
  });

  it("uses the host-resolved userData path for sessionData", () => {
    const host = createHost("/profile");

    host.setPath.mockImplementation((name, path) => {
      host.paths[name] = name === "userData" ? "/resolved/user-data" : path;
    });

    const result = initializeAppPaths({
      host,
      appName: "Freelens",
      directoryForIntegrationTesting: undefined,
      joinPaths: posix.join,
    });

    expect(result.userData).toBe("/resolved/user-data");
    expect(result.sessionData).toBe("/resolved/user-data");
  });

  it("preserves empty values for unsupported host paths", () => {
    const host = createHost("/profile");

    host.paths.recent = "";
    host.paths.module = "";

    const result = initializeAppPaths({
      host,
      appName: "Freelens",
      directoryForIntegrationTesting: undefined,
      joinPaths: posix.join,
    });

    expect(result.recent).toBe("");
    expect(result.module).toBe("");
  });

  it("propagates path configuration failures synchronously", () => {
    const host = createHost("/profile");
    const error = new Error("path configuration failed");

    host.setPath.mockImplementation(() => {
      throw error;
    });

    expect(() =>
      initializeAppPaths({
        host,
        appName: "Freelens",
        directoryForIntegrationTesting: undefined,
        joinPaths: posix.join,
      }),
    ).toThrow(error);
    expect(host.setPath).toHaveBeenCalledOnce();
  });
});
