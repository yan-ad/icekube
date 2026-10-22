/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./icon.scss";
import type { HTMLAttributes, Ref } from "react";

export function IconView({ iconRef, ...props }: HTMLAttributes<HTMLElement> & { iconRef?: Ref<HTMLElement> }) {
  return <i {...props} ref={iconRef} />;
}

/** Material-only icon for browser hosts, using Icon's public classes and DOM. */
export function MaterialIconView({
  material,
  small,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & { material: string; small?: boolean }) {
  return (
    <IconView
      {...props}
      className={`Icon material focusable${small ? " small" : ""}${className ? ` ${className}` : ""}`}
    >
      <span className="icon" data-icon-name={material}>
        {material}
      </span>
    </IconView>
  );
}
