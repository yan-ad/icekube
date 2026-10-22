/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { TreeGroup as TreeGroupView } from "./tree-view-base";

import type { TreeGroupProps } from "./tree-view-base";

export { TreeItem, TreeView } from "./tree-view-base";

export type {
  TreeGroupClasses,
  TreeGroupProps,
  TreeItemClasses,
  TreeItemProps,
  TreeViewClasses,
  TreeViewProps,
} from "./tree-view-base";

export function TreeGroup(props: TreeGroupProps) {
  return (
    <TreeGroupView
      {...props}
      collapseIcon={props.collapseIcon ?? <Icon material="expand_more" />}
      expandIcon={props.expandIcon ?? <Icon material="chevron_right" />}
    />
  );
}
