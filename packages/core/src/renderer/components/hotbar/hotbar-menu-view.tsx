/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./hotbar-menu.scss";

import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";

import type { IClassName } from "@freelensapp/utilities";

import type { MouseEventHandler, ReactNode } from "react";

export interface HotbarMenuViewProps {
  children?: ReactNode;
  selector?: ReactNode;
  className?: IClassName;
  draggingOver?: boolean;
  autoHide?: boolean;
  visible?: boolean;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
}

/** Chrome only. The Electron host retains its DnD context, cells and selector behavior. */
export function HotbarMenuView({
  children,
  selector,
  className,
  draggingOver = false,
  autoHide = false,
  visible = false,
  onMouseLeave,
}: HotbarMenuViewProps) {
  return (
    <div
      className={cssNames("HotbarMenu flex flex-col", { draggingOver, autoHide, visible }, className)}
      onMouseLeave={onMouseLeave}
    >
      <div className="HotbarItems flex flex-col">{children}</div>
      {selector}
    </div>
  );
}
