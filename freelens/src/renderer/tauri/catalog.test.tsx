/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriCatalog } from "./catalog";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

afterEach(cleanup);
const snapshot: CatalogSnapshot = {
  protocolVersion: 2,
  scope: "local",
  warnings: [],
  categories: [
    {
      id: "example/KubernetesCluster",
      name: "Clusters",
      kind: "KubernetesCluster",
      group: "example",
      icon: "kubernetes",
    },
    { id: "example/Link", name: "Links", kind: "Link", group: "example", icon: "link" },
  ],
  entities: [
    {
      id: "z",
      name: "Zulu",
      kind: "KubernetesCluster",
      group: "example",
      source: "local",
      labels: { team: "alpha" },
      status: "disconnected",
      icon: null,
      action: null,
    },
    {
      id: "a",
      name: "Alpha",
      kind: "Link",
      group: "example",
      source: "local",
      labels: {},
      status: "available",
      icon: { material: "home", background: "#00897b" },
      action: "welcome",
    },
  ],
};
const props = () => ({ snapshot, pinnedIds: new Set<string>(), onRunEntity: vi.fn(), onTogglePin: vi.fn() });

describe("TauriCatalog", () => {
  it("reopens the same pinned entity after closing and clears details when Catalog is selected", () => {
    const original = props();
    const rendered = render(<TauriCatalog {...original} selectedEntityId="z" selectionRevision={1} />);
    expect(screen.getByRole("region", { name: "Details for Zulu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("region", { name: "Details for Zulu" })).toBeNull();
    rendered.rerender(<TauriCatalog {...original} selectedEntityId="z" selectionRevision={2} />);
    expect(screen.getByRole("region", { name: "Details for Zulu" })).toBeTruthy();
    rendered.rerender(<TauriCatalog {...original} selectionRevision={3} />);
    expect(screen.queryByRole("region", { name: "Details for Zulu" })).toBeNull();
  });

  it("uses shared header, count, input and sorting; initially preserves Electron's unsorted source order", () => {
    render(<TauriCatalog {...props()} />);
    expect(screen.getByRole("heading", { name: "Browse All", level: 5 }).className).toBe("title");
    expect(screen.getByText("2 items").className).toContain("info-panel");
    expect(screen.getByLabelText("Search catalog").closest(".Input.SearchInput")).toBeTruthy();
    const name = screen.getByRole("columnheader", { name: "Name" });
    expect(name.getAttribute("aria-sort")).toBe("none");
    expect(screen.getAllByRole("row")[1].textContent).toContain("Zulu");
    fireEvent.click(name);
    expect(name.getAttribute("aria-sort")).toBe("ascending");
    expect(name.querySelector(".Icon.sortIcon.enabled [data-icon-name='arrow_drop_up']")).toBeTruthy();
    expect(screen.getAllByRole("row")[1].textContent).toContain("Alpha");
    fireEvent.keyDown(name, { key: "Enter" });
    expect(name.getAttribute("aria-sort")).toBe("descending");
    expect(screen.getAllByRole("row")[1].textContent).toContain("Zulu");
  });

  it("filters categories and label badges, supports keyboard search and honestly disables linking", () => {
    render(<TauriCatalog {...props()} />);
    fireEvent.click(screen.getByText("Clusters"));
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Kind" })).toBeNull();
    expect(screen.getByText("1 item")).toBeTruthy();
    fireEvent.click(screen.getByText("Browse"));
    fireEvent.click(screen.getByRole("button", { name: "team=alpha" }));
    expect(screen.getByLabelText("Search catalog").getAttribute("value")).toBe("team=alpha");
    expect(screen.queryByText("Alpha")).toBeNull();
    const input = screen.getByLabelText("Search catalog");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("2 items")).toBeTruthy();
    fireEvent.change(input, { target: { value: "missing" } });
    expect(screen.getByText("Filtered: 0 / 2")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Clear search" }), { key: " " });
    expect(screen.getByText("2 items")).toBeTruthy();
    act(() => input.blur());
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(input);
    const link = screen.getByRole("button", { name: "Link search (unavailable)" }) as HTMLButtonElement;
    expect(link.disabled).toBe(true);
    expect(link.title).toContain("not available");
    expect(link.nextElementSibling?.textContent).toBe("SOON");
    expect(link.nextElementSibling?.hasAttribute("data-unimplemented")).toBe(true);
  });

  it("uses builtin material avatars, cluster initials and the bundled Kubernetes category SVG", () => {
    const { container } = render(<TauriCatalog {...props()} />);
    const cluster = screen.getByTestId("catalog-entity-z");
    expect(cluster.querySelector(".Avatar")?.textContent).toBe("Zu");
    const builtin = screen.getByTestId("catalog-entity-a");
    expect(builtin.querySelector(".Avatar [data-icon-name='home']")).toBeTruthy();
    expect((builtin.querySelector(".Avatar") as HTMLElement).style.background).toBe("rgb(0, 137, 123)");
    expect(container.querySelector("[data-icon-name='kubernetes'] svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "team=alpha" }).className).toContain("badge");
  });

  it("pins by mouse/keyboard without running the entity and responds to controlled pinned state", () => {
    const callbacks = props();
    const { rerender } = render(<TauriCatalog {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Hotbar: Alpha" }));
    expect(callbacks.onTogglePin).toHaveBeenLastCalledWith("a");
    expect(callbacks.onRunEntity).not.toHaveBeenCalled();
    rerender(<TauriCatalog {...callbacks} pinnedIds={new Set(["a"])} />);
    const pin = screen.getByRole("button", { name: "Remove from Hotbar: Alpha" });
    expect(pin.querySelector("[data-icon-name='push_off'] svg")).toBeTruthy();
    fireEvent.keyDown(pin, { key: "Enter" });
    expect(callbacks.onTogglePin).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Open Alpha" }));
    expect(callbacks.onRunEntity).toHaveBeenCalledWith("a");
  });

  it("opens details locally and exposes genuine row actions with explicit unsupported cluster reasons", () => {
    const callbacks = props();
    render(<TauriCatalog {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Zulu" }));
    expect(screen.getByRole("menuitem", { name: "Connect" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(screen.getByRole("menuitem", { name: "Connect" })).getByText("SOON")).toBeTruthy();
    expect(within(screen.getByRole("menuitem", { name: "Settings" })).getByText("SOON")).toBeTruthy();
    expect(within(screen.getByRole("menuitem", { name: "View Details" })).queryByText("SOON")).toBeNull();
    expect(within(screen.getByRole("menuitem", { name: "Add to Hotbar" })).queryByText("SOON")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Settings" }).title).toContain("not available");
    fireEvent.click(screen.getByRole("menuitem", { name: "Connect" }));
    expect(callbacks.onRunEntity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to Hotbar" }));
    expect(callbacks.onTogglePin).toHaveBeenCalledWith("z");
    fireEvent.click(screen.getByRole("button", { name: "Actions for Zulu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View Details" }));
    expect(within(screen.getByRole("region", { name: "Details for Zulu" })).getByText("Zulu")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Details for Zulu" })).getByText("SOON")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close details" }));
    fireEvent.click(screen.getByTestId("catalog-entity-z"));
    expect(screen.queryByRole("region", { name: "Details for Zulu" })).toBeNull();
    expect(callbacks.onRunEntity).toHaveBeenCalledWith("z");
  });

  it("marks deferred Preferences without marking working rows, pins, or real cluster status", () => {
    const callbacks = props();
    render(
      <TauriCatalog
        {...callbacks}
        snapshot={{
          ...snapshot,
          entities: [
            ...snapshot.entities,
            {
              ...snapshot.entities[1],
              id: "preferences-entity",
              name: "Preferences",
              kind: "General",
              action: null,
            },
          ],
        }}
      />,
    );
    const preferences = screen.getByTestId("catalog-entity-preferences-entity");
    expect(within(preferences).getByText("SOON")).toBeTruthy();
    expect(within(preferences).getByText("Preferences").nextElementSibling?.textContent).toBe("SOON");
    expect(within(screen.getByTestId("catalog-entity-z")).getByText("disconnected")).toBeTruthy();
    expect(within(screen.getByTestId("catalog-entity-z")).queryByText("SOON")).toBeNull();
    expect(within(screen.getByTestId("catalog-entity-a")).queryByText("SOON")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add to Hotbar: Preferences" }));
    expect(callbacks.onTogglePin).toHaveBeenCalledWith("preferences-entity");
    expect(callbacks.onRunEntity).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open Zulu" }));
    expect(callbacks.onRunEntity).toHaveBeenCalledWith("z");
  });

  it("toggles matching header/body columns and keyboard-opens/closes the visibility menu", () => {
    render(<TauriCatalog {...props()} />);
    const trigger = screen.getByRole("button", { name: "Column visibility" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu", { name: "Column visibility" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Source" }));
    expect(screen.queryByRole("columnheader", { name: "Source" })).toBeNull();
    expect(within(screen.getByTestId("catalog-entity-z")).getAllByRole("cell")).toHaveLength(5);
    fireEvent.click(screen.getByRole("checkbox", { name: "Source" }));
    expect(screen.getByRole("columnheader", { name: "Source" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Column visibility" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("shows safe snapshot warnings and renders DTO strings as text, never HTML", () => {
    const unsafe = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <TauriCatalog
        {...props()}
        snapshot={{
          ...snapshot,
          warnings: ["A local kubeconfig could not be read."],
          entities: [
            {
              ...snapshot.entities[0],
              name: unsafe,
              labels: { note: unsafe },
              icon: { material: unsafe, background: "teal" },
            },
          ],
        }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("could not be read");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: `note=${unsafe}` })).toBeTruthy();
  });

  it("renders an empty catalog without fake rows or unsupported add controls", () => {
    render(<TauriCatalog {...props()} snapshot={{ ...snapshot, entities: [] }} />);
    expect(screen.getByText("No catalog entities found.")).toBeTruthy();
    expect(screen.queryByText("Zulu")).toBeNull();
    expect(screen.queryByText("View Details")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add cluster/i })).toBeNull();
  });
});
