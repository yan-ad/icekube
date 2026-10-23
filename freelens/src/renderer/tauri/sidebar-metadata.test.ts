/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SidebarMenuItem,
  sidebarMenuItemIds,
} from "../../../../packages/core/src/common/sidebar-menu-items-starting-order";
import { clusterSidebarItems, workloadsTabs } from "./sidebar-metadata";

const root = resolve(import.meta.dirname, "../../../..");
describe("static built-in sidebar parity", () => {
  it("contains every core sidebar registration, with original title, parent and order", () => {
    const paths = globSync("packages/core/src/renderer/components/**/*.injectable.{ts,tsx}", { cwd: root })
      .filter(
        (path) =>
          !path.endsWith("groups-sidebar-items-computed.injectable.ts") &&
          !path.endsWith("extension-sidebar-item-registrator.injectable.tsx"),
      )
      .filter((path) =>
        readFileSync(resolve(root, path), "utf8").includes("injectionToken: sidebarItemInjectionToken"),
      );
    expect(clusterSidebarItems.map((item) => item.path).sort()).toEqual(paths.sort());
    for (const item of clusterSidebarItems) {
      const source = readFileSync(resolve(root, item.path), "utf8");
      expect(source).toContain(`"${item.title}"`);
      const literalOrder = source.match(/orderNumber: (\d+)/);
      if (literalOrder) expect(item.order).toBe(Number(literalOrder[1]));
      else expect(item.order).toBe(sidebarMenuItemIds[item.id as SidebarMenuItem]);
      const parent = source.match(/parentId: (\w+)\.id/);
      if (!parent) expect(item.parentId).toBeNull();
      else {
        const path = source.match(new RegExp(`import ${parent[1]} from "([^"]+)"`))![1];
        const parentItem = clusterSidebarItems.find(
          (candidate) => resolve(root, candidate.path).replace(/\.tsx?$/, "") === resolve(root, item.path, "..", path),
        );
        expect(item.parentId).toBe(parentItem?.id);
      }
    }
    expect(
      clusterSidebarItems
        .filter((item) => item.parentId === null)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id),
    ).toEqual(Object.values(SidebarMenuItem));
    expect(workloadsTabs.map((item) => item.title)).toEqual([
      "Overview",
      "Pods",
      "Deployments",
      "Daemon Sets",
      "Stateful Sets",
      "Replica Sets",
      "Replication Controllers",
      "Jobs",
      "Cron Jobs",
    ]);
  });
});
