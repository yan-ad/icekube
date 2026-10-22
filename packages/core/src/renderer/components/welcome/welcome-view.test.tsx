/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act, fireEvent, render } from "@testing-library/react";
import { observable, runInAction } from "mobx";
import { describe, expect, it, vi } from "vitest";
import { WelcomeView } from "./welcome-view";

describe("WelcomeView", () => {
  it("preserves the default welcome text and menu actions", () => {
    const click = vi.fn();
    const rendered = render(
      <WelcomeView
        productName="Freelens"
        menuItems={[{ title: "Browse Clusters in Catalog", icon: "view_list", click }]}
        renderIcon={({ svg, material }) => <span>{svg ?? material}</span>}
      />,
    );
    expect(rendered.getByText("Welcome to Freelens!")).toBeInTheDocument();
    expect(rendered.getByText(/auto-detected your clusters/)).toBeInTheDocument();
    fireEvent.click(rendered.getByText("Browse Clusters in Catalog"));
    expect(click).toHaveBeenCalledOnce();
  });

  it("keeps observable menu titles reactive", () => {
    const title = observable.box("Before");
    const rendered = render(
      <WelcomeView
        productName="Freelens"
        menuItems={[{ title: () => title.get(), icon: "view_list", click: vi.fn() }]}
        renderIcon={() => null}
      />,
    );
    expect(rendered.getByText("Before")).toBeInTheDocument();
    act(() => runInAction(() => title.set("After")));
    expect(rendered.getByText("After")).toBeInTheDocument();
  });

  it("allows the host to describe an isolated profile without claiming cluster discovery", () => {
    const rendered = render(
      <WelcomeView productName="Freelens" menuItems={[]} renderIcon={() => null} introduction="Isolated profile" />,
    );
    expect(rendered.getByText("Isolated profile")).toBeInTheDocument();
    expect(rendered.queryByText(/auto-detected your clusters/)).not.toBeInTheDocument();
  });
});
