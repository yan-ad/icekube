/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { ReactNode } from "react";

/** Shared name-cell content; each host supplies its avatar and available actions. */
export function CatalogNameView({ name, avatar, actions }: { name: string; avatar: ReactNode; actions?: ReactNode }) {
  return (
    <>
      {avatar}
      <span>{name}</span>
      {actions}
    </>
  );
}
