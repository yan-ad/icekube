/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./table-cell.scss";

import autoBindReact from "auto-bind/react";
import React from "react";
import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";

import type { TableCellProps } from "@freelensapp/list-layout";

export type TableCellElem = React.ReactElement<TableCellProps>;

export interface TableCellViewProps extends TableCellProps, React.AriaAttributes {
  role?: React.AriaRole;
  tabIndex?: number;
  renderSortIcon?: (active: boolean, direction: string) => React.ReactNode;
  renderCheckbox?: (checked: boolean) => React.ReactNode;
}

export class TableCellView extends React.Component<TableCellViewProps> {
  private suppressClick = false;

  constructor(props: TableCellViewProps) {
    super(props);
    autoBindReact(this);
  }

  onClick(evt: React.MouseEvent<HTMLDivElement>) {
    const { _sort, sortBy, onClick } = this.props;

    if (this.suppressClick) {
      return;
    }

    onClick?.(evt);

    if (_sort && typeof sortBy === "string") {
      _sort(sortBy);
    }
  }

  private suppressClickUntilMouseUp() {
    this.suppressClick = true;

    const clear = () => {
      window.removeEventListener("mouseup", clear);
      // Defer clearing so the subsequent click event (fired after mouseup) is suppressed.
      requestAnimationFrame(() => {
        this.suppressClick = false;
      });
    };

    window.addEventListener("mouseup", clear);
  }

  renderSortIcon() {
    const { sortBy, _sorting } = this.props;

    if (!_sorting || !sortBy) {
      return null;
    }

    const sortActive = _sorting.sortBy === sortBy;
    const sortIconName = !sortActive || _sorting.orderBy === "desc" ? "arrow_drop_down" : "arrow_drop_up";

    return (
      this.props.renderSortIcon?.(sortActive, sortIconName) ?? (
        <span className={cssNames("sortIcon", { enabled: sortActive })} aria-hidden>
          {sortIconName === "arrow_drop_up" ? "▴" : "▾"}
        </span>
      )
    );
  }

  renderCheckbox() {
    const { checkbox, isChecked } = this.props;
    const showCheckbox = isChecked !== undefined;

    if (checkbox && showCheckbox) {
      return this.props.renderCheckbox?.(isChecked) ?? null;
    }

    return null;
  }

  render() {
    const {
      renderSortIcon,
      renderCheckbox,
      className,
      checkbox,
      isChecked,
      scrollable,
      sortBy,
      _sort,
      _sorting,
      _nowrap,
      children,
      title,
      showWithColumn,
      resizable,
      onResizeStart,
      onResizeReset,
      style,
      ...cellProps
    } = this.props;

    const classNames = cssNames("TableCell", className, {
      checkbox,
      scrollable,
      nowrap: _nowrap,
      sorting: _sort && typeof sortBy === "string",
    });
    const content = title || children;

    return (
      <div {...cellProps} className={classNames} style={style} onClick={this.onClick}>
        {this.renderCheckbox()}
        {_nowrap ? <div className="content">{content}</div> : content}
        {this.renderSortIcon()}
        {resizable ? (
          <div
            className="resize-handle"
            onMouseDown={(event) => {
              event.stopPropagation();
              this.suppressClickUntilMouseUp();
              onResizeStart?.(event.nativeEvent);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onResizeReset?.();
            }}
          />
        ) : null}
      </div>
    );
  }
}
