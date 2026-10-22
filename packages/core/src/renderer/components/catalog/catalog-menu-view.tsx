/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import { HorizontalLine } from "../horizontal-line/horizontal-line";
import { TreeGroup, TreeItem, TreeView } from "../tree-view/tree-view-base";
import { browseCatalogTab } from "./catalog-browse-tab";
import styles from "./catalog-menu.module.scss";
import treeStyles from "./catalog-tree.module.scss";

import type { JSX, ReactNode } from "react";

export interface CatalogMenuViewCategory {
  id: string;
  label: JSX.Element | string;
  icon?: JSX.Element;
}

export interface CatalogMenuViewProps {
  categories: CatalogMenuViewCategory[];
  activeTab: string | undefined;
  onItemClick: (id: string) => void;
  collapseIcon?: JSX.Element;
  expandIcon?: JSX.Element;
  header?: ReactNode;
}

/** Hosts adapt category data and icon rendering without loading a registry in the view. */
export const CatalogMenuView = observer(function CatalogMenuView({
  categories,
  activeTab,
  onItemClick,
  collapseIcon,
  expandIcon,
  header,
}: CatalogMenuViewProps) {
  return (
    <div className="flex flex-col w-full">
      {header}
      <div className={styles.catalog}>Catalog</div>
      <TreeView>
        <TreeItem
          classes={treeStyles}
          label="Browse"
          data-testid="*-tab"
          onClick={() => onItemClick(browseCatalogTab)}
          selected={activeTab === browseCatalogTab}
        />
        <HorizontalLine size="xxs" />
        <TreeGroup
          classes={treeStyles}
          label={<div className={styles.parent}>Categories</div>}
          collapseIcon={collapseIcon}
          expandIcon={expandIcon}
        >
          {categories.map((category) => (
            <TreeItem
              classes={treeStyles}
              key={category.id}
              icon={category.icon}
              label={category.label}
              selected={activeTab === category.id}
              data-testid={`${category.id}-tab`}
              onClick={() => onItemClick(category.id)}
            />
          ))}
        </TreeGroup>
      </TreeView>
    </div>
  );
});
