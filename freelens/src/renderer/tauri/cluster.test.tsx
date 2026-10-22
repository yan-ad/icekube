/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriCluster } from "./cluster";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

afterEach(cleanup);
const entity: CatalogSnapshot["entities"][number] = {
  id: "test-cluster",
  name: "Test Cluster",
  kind: "KubernetesCluster",
  group: "entity.k8slens.dev",
  source: "local",
  labels: {},
  status: "disconnected",
  icon: null,
  action: null,
};

describe("cluster landing checkpoint", () => {
  it("uses the shared status view without simulating a connection", () => {
    const navigate = vi.fn();
    const { container } = render(<TauriCluster entity={entity} onNavigateCatalog={navigate} />);
    expect(screen.getByRole("heading", { name: "Test Cluster" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("SOON");
    expect(screen.getByText(/No connection has been started/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector(".Spinner")).toBeNull();
    expect(screen.queryByText(/Authentication proxy started/)).toBeNull();
    expect(entity.status).toBe("disconnected");
    fireEvent.click(screen.getByRole("button", { name: "Back to Catalog" }));
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("handles removed or unknown clusters without showing fake progress", () => {
    render(<TauriCluster onNavigateCatalog={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Cluster not found" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to Catalog" })).toBeTruthy();
  });
});
