/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriPods } from "./pods";

import type { PodSummary, PodsRequest, PodsSnapshot } from "../../common/tauri/pods-protocol";

const id = "a".repeat(32);
function pod(name: string, namespace = "default"): PodSummary {
  return {
    uid: name,
    name,
    namespace,
    nodeName: "node",
    createdAt: "2024-01-01T00:00:00Z",
    phase: "Running",
    status: "Running",
    readyContainers: 1,
    totalContainers: 1,
    restartCount: 2,
    containers: [{ name: "app", ready: true, state: "running", init: false }],
    owner: { kind: "ReplicaSet", name: "owner" },
    cpu: null,
    memory: null,
  };
}
function snapshot(request: PodsRequest, pods = [pod("zulu"), pod("alpha", "other")]): PodsSnapshot {
  return {
    protocolVersion: 1,
    ...request,
    pods,
    namespaces: ["default", "other"],
    truncated: false,
    warnings: [],
    error: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("read-only Pods", () => {
  it("uses readiness-aware container brick styling instead of marking unready running containers healthy", async () => {
    const item = pod("unready");
    item.readyContainers = 0;
    item.containers[0].ready = false;
    const listPods = vi.fn(async (request: PodsRequest) => snapshot(request, [item]));
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByText("unready");
    const brick = screen.getByRole("img", { name: "app: running" });
    expect(brick.className).toContain("waiting");
    expect(brick.className).not.toContain(" running");
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });
  it("requires explicit consent, searches, sorts, changes namespace, and toggles columns", async () => {
    const listPods = vi.fn(async (request: PodsRequest) =>
      snapshot(request, request.namespace ? [pod("scoped", request.namespace)] : undefined),
    );
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    expect(listPods).not.toHaveBeenCalled();
    expect(screen.getByText(/may execute kubeconfig auth plugins/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByText("alpha");
    expect(listPods).toHaveBeenCalledWith({ clusterId: id, namespace: null });
    expect(screen.getByText("2 / 2 Pods")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Pods" });
    expect(within(table).getAllByRole("row")[1].textContent).toContain("alpha");
    fireEvent.keyDown(screen.getByRole("columnheader", { name: "Name" }), { key: "Enter" });
    expect(within(table).getAllByRole("row")[1].textContent).toContain("zulu");
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pods" }), { target: { value: "alpha" } });
    expect(screen.getByText("1 / 2 Pods")).toBeTruthy();
    expect(screen.queryByText("zulu")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pods" }), { target: { value: "nomatch" } });
    expect(screen.getByText("No Pods match your search.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pods" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Pod column visibility" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "CPU" }));
    expect(screen.queryByRole("columnheader", { name: /CPU/ })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Namespace" }), { target: { value: "other" } });
    await screen.findByText("scoped");
    expect(listPods).toHaveBeenLastCalledWith({ clusterId: id, namespace: "other" });
    expect(screen.queryByRole("checkbox", { name: /Select/ })).toBeNull();
  });
  it("shows safe errors, retries, and reports an actual empty response", async () => {
    const listPods = vi
      .fn()
      .mockRejectedValueOnce(new Error("private kubeconfig path"))
      .mockImplementation(async (request: PodsRequest) => snapshot(request, []));
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/private kubeconfig/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No Pods found in this namespace scope.");
    expect(screen.getByText("0 / 0 Pods")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => {});
    expect(listPods).toHaveBeenCalledTimes(3);
  });
  it("polls only after consent, never overlaps, and stops on unmount", async () => {
    vi.useFakeTimers();
    const first = deferred<PodsSnapshot>();
    const listPods = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (request: PodsRequest) => snapshot(request));
    const { unmount } = render(<TauriPods clusterId={id} host={{ listPods }} />);
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(listPods).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(listPods).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(snapshot({ clusterId: id, namespace: null }));
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(listPods).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(listPods).toHaveBeenCalledTimes(2);
  });
  it("discards stale namespace responses and queues only the latest scope", async () => {
    const late = deferred<PodsSnapshot>();
    const listPods = vi
      .fn()
      .mockImplementationOnce(async (request: PodsRequest) => snapshot(request))
      .mockReturnValueOnce(late.promise)
      .mockImplementation(async (request: PodsRequest) => snapshot(request, [pod("fresh", request.namespace!)]));
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByText("alpha");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Namespace" }), { target: { value: "other" } });
    expect(listPods).toHaveBeenCalledTimes(2);
    await act(async () => {
      late.resolve(snapshot({ clusterId: id, namespace: null }, [pod("stale")]));
    });
    await screen.findByText("fresh");
    expect(screen.queryByText("stale")).toBeNull();
    expect(listPods).toHaveBeenLastCalledWith({ clusterId: id, namespace: "other" });
  });
  it("requires fresh consent on cluster changes and discards old results", async () => {
    const late = deferred<PodsSnapshot>();
    const listPods = vi.fn().mockReturnValue(late.promise);
    const host = { listPods };
    const { rerender, unmount } = render(<TauriPods clusterId={id} host={host} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    rerender(<TauriPods clusterId={"b".repeat(32)} host={host} />);
    expect(screen.getByRole("button", { name: "Load Pods" })).toBeTruthy();
    await act(async () => {
      late.resolve(snapshot({ clusterId: id, namespace: null }, [pod("stale")]));
    });
    expect(screen.queryByText("stale")).toBeNull();
    expect(listPods).toHaveBeenCalledTimes(1);
    unmount();
  });
  it("recovers from all-namespace forbidden with a validated manual namespace and keeps derived options", async () => {
    const listPods = vi.fn(
      async (request: PodsRequest): Promise<PodsSnapshot> =>
        request.namespace === null
          ? { ...snapshot(request, []), namespaces: [], error: "FORBIDDEN" }
          : {
              ...snapshot(request, [pod("private-pod", request.namespace)]),
              namespaces: [request.namespace],
              warnings: ["Namespace list unavailable"],
            },
    );
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    expect(screen.queryByRole("textbox", { name: "Namespace name" })).toBeNull();
    expect(listPods).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByText("Access to Pods is forbidden.");
    const input = screen.getByRole("textbox", { name: "Namespace name" });
    for (const value of ["", "Private", "bad/name", "-private", "private-", "a".repeat(64)]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Load namespace" }));
      expect(screen.getByText("Enter a valid namespace name.")).toBeTruthy();
      expect(listPods).toHaveBeenCalledTimes(1);
    }
    fireEvent.change(input, { target: { value: "private" } });
    fireEvent.click(screen.getByRole("button", { name: "Load namespace" }));
    await screen.findByText("private-pod");
    expect(listPods).toHaveBeenLastCalledWith({ clusterId: id, namespace: "private" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Namespace list unavailable")).toBeTruthy();
    const select = screen.getByRole("combobox", { name: "Namespace" }) as HTMLSelectElement;
    expect(select.value).toBe("private");
    expect(within(select).getByRole("option", { name: "private" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pods" }), { target: { value: "nomatch" } });
    expect(screen.getByText("No Pods match your search.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText("private-pod")).toBeTruthy();
    expect(listPods).toHaveBeenCalledTimes(2);
    fireEvent.change(select, { target: { value: "" } });
    await screen.findByText("Access to Pods is forbidden.");
    expect(within(select).getByRole("option", { name: "private" })).toBeTruthy();
    expect(screen.queryByText("private-pod")).toBeNull();
    fireEvent.change(select, { target: { value: "private" } });
    await screen.findByText("private-pod");
    expect(listPods).toHaveBeenCalledTimes(4);
  });
  it("offers manual namespace entry and namespace retry when only namespace discovery is unavailable", async () => {
    const listPods = vi.fn(
      async (request: PodsRequest): Promise<PodsSnapshot> => ({
        ...snapshot(request, [pod("visible-pod", request.namespace ?? "derived")]),
        namespaces: [request.namespace ?? "derived"],
        warnings: ["Namespace list unavailable"],
      }),
    );
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByText("visible-pod");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      within(screen.getByRole("combobox", { name: "Namespace" })).getByRole("option", { name: "derived" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry namespaces" }));
    await act(async () => {});
    expect(listPods).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByRole("textbox", { name: "Namespace name" }), { target: { value: "private" } });
    fireEvent.click(screen.getByRole("button", { name: "Load namespace" }));
    await act(async () => {});
    expect(listPods).toHaveBeenLastCalledWith({ clusterId: id, namespace: "private" });
    const select = screen.getByRole("combobox", { name: "Namespace" });
    expect(within(select).getByRole("option", { name: "derived" })).toBeTruthy();
    expect(within(select).getByRole("option", { name: "private" })).toBeTruthy();
  });
  it("stops in-flight refreshes, ignores their results, and resumes only with new consent on the same cluster", async () => {
    vi.useFakeTimers();
    const late = deferred<PodsSnapshot>();
    const listPods = vi
      .fn()
      .mockReturnValueOnce(late.promise)
      .mockImplementation(async (request: PodsRequest) => snapshot(request, [pod("resumed")]));
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop refreshing" }));
    expect(screen.getByRole("button", { name: "Load Pods" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Refresh" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      late.resolve(snapshot({ clusterId: id, namespace: null }, [pod("stopped-result")]));
    });
    expect(screen.queryByText("stopped-result")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(listPods).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await act(async () => {});
    expect(screen.getByText("resumed")).toBeTruthy();
    expect(listPods).toHaveBeenLastCalledWith({ clusterId: id, namespace: null });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(listPods).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Stop refreshing" }));
    expect(screen.queryByText("resumed")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(listPods).toHaveBeenCalledTimes(3);
  });
  it("queues re-consent behind a stopped request without overlapping or accepting its stale response", async () => {
    vi.useFakeTimers();
    const late = deferred<PodsSnapshot>();
    const listPods = vi
      .fn()
      .mockReturnValueOnce(late.promise)
      .mockImplementation(async (request: PodsRequest) => snapshot(request, [pod("new-consent")]));
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop refreshing" }));
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(listPods).toHaveBeenCalledTimes(1);
    await act(async () => {
      late.resolve(snapshot({ clusterId: id, namespace: null }, [pod("old-consent")]));
    });
    expect(screen.queryByText("old-consent")).toBeNull();
    expect(screen.getByText("new-consent")).toBeTruthy();
    expect(listPods).toHaveBeenCalledTimes(2);
  });
  it("hides stale rows when a refresh errors and restores them only after a successful retry", async () => {
    const listPods = vi
      .fn()
      .mockImplementationOnce(async (request: PodsRequest) => snapshot(request, [pod("old-row")]))
      .mockImplementationOnce(async (request: PodsRequest) => ({
        ...snapshot(request, [pod("error-row")]),
        error: "FORBIDDEN",
      }))
      .mockImplementation(async (request: PodsRequest) => snapshot(request, [pod("new-row")]));
    render(<TauriPods clusterId={id} host={{ listPods }} />);
    fireEvent.click(screen.getByRole("button", { name: "Load Pods" }));
    await screen.findByText("old-row");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Access to Pods is forbidden.");
    expect(screen.queryByText("old-row")).toBeNull();
    expect(screen.queryByText("error-row")).toBeNull();
    expect(screen.queryByText(/No Pods found/)).toBeNull();
    expect(screen.getByText("Not loaded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("new-row");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
