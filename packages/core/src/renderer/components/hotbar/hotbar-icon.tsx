/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { Tooltip } from "@freelensapp/tooltip";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { useState } from "react";
import normalizeCatalogEntityContextMenuInjectable from "../../catalog/normalize-menu-item.injectable";
import { Menu, MenuItem } from "../menu";
import { HotbarIconView } from "./hotbar-icon-view";

import type { CatalogEntityContextMenu } from "../../../common/catalog";
import type { NormalizeCatalogEntityContextMenu } from "../../catalog/normalize-menu-item.injectable";
import type { AvatarProps } from "../avatar";

export interface HotbarIconProps extends AvatarProps {
  uid: string;
  source?: string;
  material?: string;
  onMenuOpen?: () => void;
  active?: boolean;
  menuItems?: CatalogEntityContextMenu[];
  disabled?: boolean;
  tooltip?: string;
}

interface Dependencies {
  normalizeMenuItem: NormalizeCatalogEntityContextMenu;
}

const NonInjectedHotbarIcon = observer(
  ({ menuItems = [], size = 40, tooltip, normalizeMenuItem, ...props }: HotbarIconProps & Dependencies) => {
    const { uid, title, src, material, active, className, source, disabled, onMenuOpen, onClick, children, ...rest } =
      props;
    const id = `hotbarIcon-${uid}`;
    const [menuOpen, setMenuOpen] = useState(false);

    const toggleMenu = () => {
      setMenuOpen(!menuOpen);
    };

    return (
      <HotbarIconView
        {...rest}
        uid={uid}
        title={title}
        source={source}
        active={active}
        contextMenuAvailable={menuItems.length > 0}
        className={className}
        disabled={disabled}
        size={size}
        src={src}
        onClick={onClick}
        materialIcon={material ? <Icon material={material} /> : undefined}
      >
        {tooltip && <Tooltip targetId={id}>{tooltip}</Tooltip>}
        {children}
        <Menu
          usePortal
          htmlFor={id}
          isOpen={menuOpen}
          toggleEvent="contextmenu"
          position={{ right: true, bottom: true }} // FIXME: position does not work
          open={() => {
            onMenuOpen?.();
            toggleMenu();
          }}
          close={() => toggleMenu()}
        >
          {menuItems.map(normalizeMenuItem).map((menuItem) => (
            <MenuItem key={menuItem.title} onClick={menuItem.onClick}>
              {menuItem.title}
            </MenuItem>
          ))}
        </Menu>
      </HotbarIconView>
    );
  },
);

export const HotbarIcon = withInjectables<Dependencies, HotbarIconProps>(NonInjectedHotbarIcon, {
  getProps: (di, props) => ({
    ...props,
    normalizeMenuItem: di.inject(normalizeCatalogEntityContextMenuInjectable),
  }),
});
