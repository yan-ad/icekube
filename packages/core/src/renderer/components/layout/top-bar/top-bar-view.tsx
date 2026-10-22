/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Gutter } from "../../gutter";
import { Map } from "../../map";
import styles from "./top-bar.module.scss";

import type { ComponentType, MouseEventHandler } from "react";

export interface TopBarViewItem {
  id: string;
  Component: ComponentType;
}

export interface TopBarViewProps {
  itemsOnLeft: TopBarViewItem[];
  itemsOnRight: TopBarViewItem[];
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
}

/** Preserve the registered item order and the original dragging and gutter boundaries. */
export function TopBarView({ itemsOnLeft, itemsOnRight, onDoubleClick }: TopBarViewProps) {
  return (
    <div className={styles.topBar} onDoubleClick={onDoubleClick}>
      <div className={styles.items}>
        <Map items={itemsOnLeft} getSeparator={() => <Gutter size="sm" />}>
          {toItemWhichWorksWithWindowDraggingAndDoubleClicking}
        </Map>
        <div className={styles.separator} />
        <Map items={itemsOnRight} getSeparator={() => <Gutter size="sm" />}>
          {toItemWhichWorksWithWindowDraggingAndDoubleClicking}
        </Map>
      </div>
    </div>
  );
}

const toItemWhichWorksWithWindowDraggingAndDoubleClicking = (item: TopBarViewItem) => (
  <div className={styles.preventedDragging} onDoubleClick={(event) => event.stopPropagation()}>
    <item.Component />
  </div>
);
