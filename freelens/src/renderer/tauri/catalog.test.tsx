/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TauriCatalog } from "./catalog";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

afterEach(cleanup);
const snapshot: CatalogSnapshot = {
  protocolVersion: 1,
  scope: "built-in",
  categories: [
    { id: "example/Cluster", name: "Clusters", kind: "Cluster", group: "example", icon: "" },
    { id: "example/Link", name: "Links", kind: "Link", group: "example", icon: "" },
  ],
  entities: [
    {
      id: "z",
      name: "Zulu",
      kind: "Cluster",
      group: "example",
      source: "local",
      labels: { team: "alpha" },
      status: "disconnected",
    },
    { id: "a", name: "Alpha", kind: "Link", group: "example", source: "local", labels: {}, status: "available" },
  ],
};

describe("TauriCatalog", () => {
  it("uses the shared list header, count, search and material sorting controls", () => {
    const { container } = render(<TauriCatalog snapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "Browse All", level: 5 }).className).toBe("title");
    expect(screen.getByText("2 items").className).toContain("info-panel");
    expect(screen.getByLabelText("Search catalog").closest(".Input.SearchInput")).toBeTruthy();
    const name = screen.getByRole("columnheader", { name: "Name" });
    expect(name.className).toContain("sorting");
    expect(name.querySelector(".Icon.sortIcon.enabled [data-icon-name='arrow_drop_up']")).toBeTruthy();
    expect(screen.getAllByRole("row")[1].textContent).toContain("Alpha");
    fireEvent.click(name);
    expect(name.getAttribute("aria-sort")).toBe("descending");
    expect(screen.getAllByRole("row")[1].textContent).toContain("Zulu");
    fireEvent.keyDown(name, { key: "Enter" });
    expect(name.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.change(screen.getByLabelText("Search catalog"), { target: { value: "missing" } });
    expect(screen.getByText("Filtered: 0 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(container.querySelectorAll(".Avatar")).toHaveLength(2);
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });

  it("filters categories, browses all, and searches labels", () => {
    render(<TauriCatalog snapshot={snapshot} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.click(screen.getByText("Clusters"));
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByRole("heading", { name: "Clusters", level: 5 })).toBeTruthy();
    expect(screen.getByText("1 item")).toBeTruthy();
    expect(screen.getByText("Zulu")).toBeTruthy();
    fireEvent.click(screen.getByText("Browse"));
    fireEvent.change(screen.getByLabelText("Search catalog"), { target: { value: "alpha" } });
    expect(screen.getByText("Zulu")).toBeTruthy();
    expect(screen.queryByText("Home")).toBeNull();
    expect(screen.queryByText("Refresh")).toBeNull();
  });

  it("renders an empty catalog without fake rows or actions", () => {
    render(<TauriCatalog snapshot={{ ...snapshot, entities: [] }} />);
    expect(screen.getByText("No catalog entities found.")).toBeTruthy();
    expect(screen.queryByText("Zulu")).toBeNull();
    expect(screen.queryByText("View Details")).toBeNull();
  });
});
