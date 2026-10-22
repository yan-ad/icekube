// @vitest-environment jsdom
/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultHotbarCells } from "../../../../packages/core/src/features/hotbar/storage/common/types";
import { useCatalogHotbar } from "./hotbar";
import { TauriShell } from "./shell";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

const hotbar = {
  items: Array(defaultHotbarCells).fill(null),
  pinnedIds: new Set<string>(),
  toggle: vi.fn(),
  remove: vi.fn(),
  persistence: "memory" as const,
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Tauri launcher chrome", () => {
  it("uses the shared launcher regions with the original empty hotbar cells and disabled selector", () => {
    const { container, getByText, getByTestId } = render(
      <TauriShell hotbar={hotbar} onRunEntity={vi.fn()} onNavigateHome={vi.fn()}>
        <section>Contents</section>
      </TauriShell>,
    );
    expect(container.querySelector(".ClusterManager > main")?.contains(getByText("Contents"))).toBe(true);
    expect(container.querySelector(".HotbarMenu > .HotbarItems")?.childNodes.length).toBe(defaultHotbarCells);
    expect(getByTestId("status-bar-left").textContent).toContain("Pins: session only");
    expect(getByTestId("status-bar-right").childNodes.length).toBe(0);
    expect(container.querySelector("#lens-views")).toBeNull();
    expect(getByTestId("history-back").getAttribute("aria-disabled")).toBe("true");
    expect(getByTestId("history-forward").getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps home, back and forward in registered order and calls real navigation", () => {
    window.history.replaceState(null, "", "/#/catalog");
    const goHome = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { getByTestId, container } = render(
      <TauriShell hotbar={hotbar} onRunEntity={vi.fn()} onNavigateHome={goHome}>
        Contents
      </TauriShell>,
    );
    const navigation = [...container.querySelectorAll(".Icon")].map((item) => item.getAttribute("data-testid"));
    expect(navigation).toEqual(["home-button", "history-back", "history-forward"]);
    fireEvent.click(getByTestId("home-button"));
    expect(goHome).toHaveBeenCalledOnce();
    act(() => {
      window.history.pushState(null, "", "/#/welcome");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    fireEvent.click(getByTestId("history-back"));
    expect(back).toHaveBeenCalledOnce();
  });

  it("does not install a custom application menu for unsupported commands", () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { getByTestId } = render(
      <TauriShell hotbar={hotbar} onRunEntity={vi.fn()} onNavigateHome={vi.fn()}>
        Contents
      </TauriShell>,
    );
    expect(getByTestId("window-menu").getAttribute("aria-disabled")).toBe("true");
    expect(getByTestId("window-menu").getAttribute("title")).toBe("Not available in Tauri yet");
  });

  it("does not duplicate macOS native window controls or menu", () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    const { queryByTestId } = render(
      <TauriShell hotbar={hotbar} onRunEntity={vi.fn()} onNavigateHome={vi.fn()}>
        Contents
      </TauriShell>,
    );
    expect(queryByTestId("window-menu")).toBeNull();
    expect(queryByTestId("window-close")).toBeNull();
  });
});

const builtin = (id: string, name: string, action: "welcome" | "catalog"): CatalogSnapshot["entities"][number] => ({
  id,
  name,
  action,
  source: "app",
  kind: "General",
  group: "entity.k8slens.dev",
  status: "active",
  labels: {},
  icon: { material: action === "welcome" ? "home" : "view_list", background: "var(--primary)" },
});
const snapshot: CatalogSnapshot = {
  protocolVersion: 2,
  scope: "local",
  categories: [],
  warnings: [],
  entities: [
    builtin("welcome-page-entity", "Welcome Page", "welcome"),
    builtin("catalog-entity", "Catalog", "catalog"),
  ],
};
const cluster: CatalogSnapshot["entities"][number] = {
  id: "local-cluster",
  name: "Local Cluster",
  action: null,
  source: "kubeconfig",
  kind: "KubernetesCluster",
  group: "entity.k8slens.dev",
  status: "disconnected",
  labels: {},
  icon: null,
};

describe("Catalog hotbar model adapter", () => {
  it("waits for builtins then seeds the real default layout and keeps pins on snapshot refresh", async () => {
    const { result, rerender } = renderHook(({ data }: { data?: CatalogSnapshot }) => useCatalogHotbar(data), {
      initialProps: { data: undefined as CatalogSnapshot | undefined },
    });
    expect(result.current.pinnedIds.size).toBe(0);
    rerender({ data: snapshot });
    await waitFor(() => expect([...result.current.pinnedIds]).toEqual(["welcome-page-entity", "catalog-entity"]));
    expect(result.current.items).toHaveLength(defaultHotbarCells);
    act(() => result.current.toggle(cluster));
    expect(result.current.pinnedIds.has(cluster.id)).toBe(true);
    rerender({ data: { ...snapshot, entities: [...snapshot.entities, { ...cluster, name: "Renamed" }] } });
    expect(result.current.pinnedIds.has(cluster.id)).toBe(true);
    act(() => result.current.toggle(cluster));
    expect(result.current.pinnedIds.has(cluster.id)).toBe(false);
  });

  it("roundtrips the Hotbar JSON schema without repinning defaults removed by the user", async () => {
    const first = renderHook(() => useCatalogHotbar(snapshot));
    await waitFor(() => expect(first.result.current.pinnedIds.size).toBe(2));
    act(() => first.result.current.toggle(snapshot.entities[0]));
    first.unmount();
    const second = renderHook(() => useCatalogHotbar(snapshot));
    await waitFor(() => expect([...second.result.current.pinnedIds]).toEqual(["catalog-entity"]));
  });

  it("handles full bars via the model callback and storage failures without losing session pins", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useCatalogHotbar(snapshot));
    await waitFor(() => expect(result.current.persistence).toBe("memory"));
    for (let i = 0; i < defaultHotbarCells - 2; i++) {
      act(() => result.current.toggle({ ...cluster, id: `cluster-${i}` }));
    }
    act(() => result.current.toggle(cluster));
    expect(result.current.pinnedIds.size).toBe(defaultHotbarCells);
    expect(result.current.message).toContain("full");
  });

  it("renders built-in icons and invokes host details for a pinned cluster without connection indicators", async () => {
    const run = vi.fn();
    function Launcher() {
      const data = { ...snapshot, entities: [...snapshot.entities, cluster] };
      const pins = useCatalogHotbar(data);
      return (
        <>
          <button onClick={() => pins.toggle(cluster)}>Pin cluster</button>
          <TauriShell catalog={data} hotbar={pins} onRunEntity={run} onNavigateHome={vi.fn()}>
            Contents
          </TauriShell>
        </>
      );
    }
    const { getByRole, container } = render(<Launcher />);
    await waitFor(() => expect(getByRole("button", { name: "Welcome Page" })).toBeTruthy());
    fireEvent.click(getByRole("button", { name: "Pin cluster" }));
    const pinned = getByRole("button", { name: "Local Cluster" });
    fireEvent.keyDown(pinned, { key: "Enter" });
    expect(run).toHaveBeenCalledWith(cluster.id);
    expect(container.querySelectorAll(".HotbarCell")).toHaveLength(defaultHotbarCells);
    expect(container.querySelector(".online")).toBeNull();
    expect(container.querySelector("#hotbarIcon-welcome-page-entity .icon")?.textContent).toBe("home");
    fireEvent.contextMenu(pinned);
    expect(container.querySelector("#hotbarIcon-local-cluster")).not.toBeNull();
    fireEvent.click(getByRole("menuitem", { name: "Remove from Hotbar" }));
    expect(container.querySelector("#hotbarIcon-local-cluster")).toBeNull();
  });
});
