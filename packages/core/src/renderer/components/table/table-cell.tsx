/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { Checkbox } from "../checkbox";
import { TableCellView } from "./table-cell-view";

import type { TableCellProps } from "@freelensapp/list-layout";

import type React from "react";
export type TableCellElem = React.ReactElement<TableCellProps>;

export class TableCell extends TableCellView {
  renderSortIcon() {
    const { sortBy, _sorting } = this.props;
    if (!_sorting || !sortBy) return null;
    const active = _sorting.sortBy === sortBy;
    const direction = !active || _sorting.orderBy === "desc" ? "arrow_drop_down" : "arrow_drop_up";
    return <Icon className={`sortIcon${active ? " enabled" : ""}`} material={direction} />;
  }

  renderCheckbox() {
    const { checkbox, isChecked } = this.props;
    return checkbox && isChecked !== undefined ? <Checkbox value={isChecked} /> : null;
  }
}
