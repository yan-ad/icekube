/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";
import styles from "./status-bar.module.scss";

import type { StatusBarStatus } from "./current-status.injectable";
import type { StatusBarItems } from "./status-bar-items.injectable";

export interface StatusBarViewProps {
  items: StatusBarItems;
  status?: StatusBarStatus;
}

export function StatusBarView({ items, status = "default" }: StatusBarViewProps) {
  const { left, right } = items;
  const barStatus = status;
  const barStyle = barStatus === "default" ? undefined : styles[`status-${barStatus}`];

  return (
    <div className={cssNames(styles.StatusBar, barStyle)} data-testid="status-bar">
      <div className={styles.leftSide} data-testid="status-bar-left">
        {left.map((Item, index) => (
          <div className={styles.item} key={index} data-origin={Item.origin}>
            {<Item.component />}
          </div>
        ))}
      </div>
      <div className={styles.rightSide} data-testid="status-bar-right">
        {right.map((Item, index) => (
          <div className={styles.item} key={index} data-origin={Item.origin}>
            {<Item.component />}
          </div>
        ))}
      </div>
    </div>
  );
}
