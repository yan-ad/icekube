/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogMenuView } from "./catalog-menu-view";
import { CatalogNameView } from "./catalog-name-view";

describe("Catalog host-neutral views", () => {
  it("selects Browse and a real category without a DI container", () => {
    const onItemClick = vi.fn();
    render(
      <CatalogMenuView
        categories={[{ id: "test/Cluster", label: "Clusters" }]}
        activeTab="*"
        onItemClick={onItemClick}
      />,
    );
    fireEvent.click(screen.getByText("Clusters"));
    expect(onItemClick).toHaveBeenCalledWith("test/Cluster");
    fireEvent.click(screen.getByText("Browse"));
    expect(onItemClick).toHaveBeenCalledWith("browse");
  });

  it("does not invent name-cell actions", () => {
    render(<CatalogNameView name="Local cluster" avatar={<span>LC</span>} />);
    expect(screen.getByText("Local cluster")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
