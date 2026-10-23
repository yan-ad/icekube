/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriCluster } from "./cluster";
import { clusterSidebarItems, workloadsTabs } from "./sidebar-metadata";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

afterEach(cleanup);
const entity: CatalogSnapshot["entities"][number] = {
  id: "a".repeat(32),
  name: "Test Cluster",
  kind: "KubernetesCluster",
  group: "entity.k8slens.dev",
  source: "local",
  labels: {},
  status: "disconnected",
  icon: null,
  action: null,
};
describe("cluster sidebar", () => {
  it("opens Pods without auth, preserving full built-in groups and disabling every unported leaf", () => {
    const listPods = vi.fn();
    const navigate = vi.fn();
    const { container } = render(<TauriCluster entity={entity} podsHost={{ listPods }} onNavigateCatalog={navigate} />);
    expect(listPods).not.toHaveBeenCalled();
    expect(screen.getByText("Test Cluster")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pods" })).toBeTruthy();
    expect(entity.status).toBe("disconnected");
    const nav = screen.getByRole("navigation", { name: "Cluster navigation" });
    for (const item of clusterSidebarItems.filter((i) => i.parentId === null)) {
      expect(within(nav).getByRole("button", { name: new RegExp(`^${item.title}`) })).toBeTruthy();
    }
    for (const toggle of within(nav)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-expanded") === "false"))
      fireEvent.click(toggle);
    expect(within(nav).getAllByRole("button")).toHaveLength(clusterSidebarItems.length);
    for (const button of within(nav).getAllByRole("button")) {
      if (!button.hasAttribute("aria-expanded") && button.getAttribute("aria-current") !== "page") {
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.textContent).toContain("SOON");
      }
    }
    expect(within(nav).getByText("Priority Classes")).toBeTruthy();
    expect(container.querySelector("a")).toBeNull();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.replace(/SOON/g, "").trim())).toEqual(
      workloadsTabs.map((tab) => tab.title),
    );
    expect(tabs.filter((tab) => !(tab as HTMLButtonElement).disabled)).toHaveLength(1);
    const workloads = within(nav).getByRole("button", { name: /^Workloads/ });
    fireEvent.click(workloads);
    expect(workloads.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(workloads);
    expect(workloads.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Back to Catalog" }));
    expect(navigate).toHaveBeenCalledOnce();
  });
  it("handles removed clusters without fake progress", () => {
    render(<TauriCluster onNavigateCatalog={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Cluster not found" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load Pods" })).toBeNull();
  });
});
