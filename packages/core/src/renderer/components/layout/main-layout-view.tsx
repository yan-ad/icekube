/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import styles from "./main-layout.module.scss";

import type { CSSProperties, ReactNode } from "react";

export interface MainLayoutViewProps {
  sidebar: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  sidebarWidth?: number;
  resizingAnchor?: ReactNode;
}

/** Layout only: persistence, resizing policy and error handling belong to the host. */
export function MainLayoutView({
  sidebar,
  children,
  footer,
  className,
  sidebarWidth = 200,
  resizingAnchor,
}: MainLayoutViewProps) {
  return (
    <div
      className={[styles.mainLayout, className].filter(Boolean).join(" ")}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <div className={styles.sidebar}>
        {sidebar}
        {resizingAnchor}
      </div>
      <div className={styles.contents}>{children}</div>
      <div className={styles.footer}>{footer}</div>
    </div>
  );
}
