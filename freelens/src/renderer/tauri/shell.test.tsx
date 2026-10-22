// @vitest-environment jsdom
/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TauriShell } from "./shell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Tauri launcher chrome", () => {
  it("uses the shared launcher regions without invented hotbar or status data", () => {
    const { container, getByText, getByTestId } = render(
      <TauriShell onNavigateHome={vi.fn()}>
        <section>Contents</section>
      </TauriShell>,
    );
    expect(container.querySelector(".ClusterManager > main")?.contains(getByText("Contents"))).toBe(true);
    expect(container.querySelector(".HotbarMenu > .HotbarItems")?.childNodes.length).toBe(0);
    expect(getByTestId("status-bar-left").textContent).toContain("Read-only");
    expect(getByTestId("status-bar-right").childNodes.length).toBe(0);
    expect(container.querySelector("#lens-views")).toBeNull();
    expect(getByTestId("history-back").getAttribute("aria-disabled")).toBe("true");
    expect(getByTestId("history-forward").getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps home, back and forward in registered order and calls real navigation", () => {
    window.history.replaceState(null, "", "/#/catalog");
    const goHome = vi.fn();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const { getByTestId, container } = render(<TauriShell onNavigateHome={goHome}>Contents</TauriShell>);
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
    const { getByTestId } = render(<TauriShell onNavigateHome={vi.fn()}>Contents</TauriShell>);
    expect(getByTestId("window-menu").getAttribute("aria-disabled")).toBe("true");
    expect(getByTestId("window-menu").getAttribute("title")).toBe("Not available in Tauri yet");
  });

  it("does not duplicate macOS native window controls or menu", () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("MacIntel");
    const { queryByTestId } = render(<TauriShell onNavigateHome={vi.fn()}>Contents</TauriShell>);
    expect(queryByTestId("window-menu")).toBeNull();
    expect(queryByTestId("window-close")).toBeNull();
  });
});
