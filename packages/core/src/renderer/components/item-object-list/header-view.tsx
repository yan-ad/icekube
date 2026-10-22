/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./item-list-layout.scss";
import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";

import type { IClassName } from "@freelensapp/utilities";

import type { ReactNode } from "react";

/** Header slots shared by the store-backed and snapshot-backed list adapters. */
export function ItemListLayoutHeaderView({
  title,
  info,
  filters,
  search,
  className,
}: {
  title: ReactNode;
  info?: ReactNode;
  filters?: ReactNode;
  search?: ReactNode;
  className?: IClassName;
}) {
  return (
    <div className={cssNames("header flex gap-4 items-center", className)}>
      {title}
      {info && <div className="info-panel grow shrink-0 basis-0">{info}</div>}
      {filters}
      {search}
    </div>
  );
}
