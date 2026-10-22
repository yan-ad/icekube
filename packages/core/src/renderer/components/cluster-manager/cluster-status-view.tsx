/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";
import styles from "./cluster-status.module.scss";

import type { IClassName } from "@freelensapp/utilities";

import type { ReactNode } from "react";

export function ClusterStatusView({
  name,
  status,
  output,
  help,
  className,
}: {
  name: string;
  status: ReactNode;
  output?: ReactNode;
  help?: ReactNode;
  className?: IClassName;
}) {
  return (
    <div className={cssNames(styles.status, "flex flex-col m-auto items-center justify-center", className)}>
      <div className="flex flex-col items-center gap-4">
        <h2>{name}</h2>
        {status}
        {output}
        {help}
      </div>
    </div>
  );
}
