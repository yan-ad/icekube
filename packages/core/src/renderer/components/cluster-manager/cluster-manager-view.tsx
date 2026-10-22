/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./cluster-manager.scss";

import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";

import type { ReactNode } from "react";

export interface ClusterManagerViewProps {
  children: ReactNode;
  topBar: ReactNode;
  hotbar: ReactNode;
  statusBar: ReactNode;
  dialogs?: ReactNode;
  hotbarAutoHide?: boolean;
  className?: string;
  lensViews?: ReactNode;
}

/** Launcher layout shared by hosts; routing, persistence and dialogs stay with the host. */
export function ClusterManagerView({
  children,
  topBar,
  hotbar,
  statusBar,
  dialogs,
  hotbarAutoHide = false,
  className,
  lensViews = <div id="lens-views" />,
}: ClusterManagerViewProps) {
  return (
    <div className={cssNames("ClusterManager", { hotbarAutoHide }, className)}>
      {topBar}
      <main>
        {lensViews}
        {children}
      </main>
      {hotbar}
      {hotbarAutoHide && <div className="hotbar-trigger-zone" />}
      {statusBar}
      {dialogs}
    </div>
  );
}
