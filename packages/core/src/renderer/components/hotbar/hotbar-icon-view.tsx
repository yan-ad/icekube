/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "../../../../../utility-features/utilities/src/cssNames";
import { AvatarView } from "../avatar/avatar-view";
import styles from "./hotbar-icon.module.scss";

import type { StrictReactNode } from "@freelensapp/utilities";

import type { AvatarProps } from "../avatar/avatar-view";

export interface HotbarIconViewProps extends AvatarProps {
  uid: string;
  source?: string;
  active?: boolean;
  contextMenuAvailable?: boolean;
  materialIcon?: StrictReactNode;
}

/** Host-independent hotbar DOM; context menus and tooltips are supplied by the host. */
export function HotbarIconView({
  uid,
  title,
  src,
  source,
  active,
  className,
  disabled,
  onClick,
  children,
  size = 40,
  contextMenuAvailable,
  materialIcon,
  ...rest
}: HotbarIconViewProps) {
  return (
    <div className={cssNames(styles.HotbarIcon, className, { [styles.contextMenuAvailable]: contextMenuAvailable })}>
      <AvatarView
        {...rest}
        id={`hotbarIcon-${uid}`}
        title={title}
        colorHash={source ? `${title}-${source}` : title}
        className={cssNames(styles.avatar, { [styles.active]: active, [styles.hasImage]: !!src })}
        disabled={disabled}
        size={size}
        src={src}
        onClick={(event) => !disabled && onClick?.(event)}
      >
        {materialIcon}
      </AvatarView>
      {children}
    </div>
  );
}
