/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

export interface HotbarItem {
  entity: {
    uid: string;
    name: string;
    source?: string;
  };
  params?: {
    [key: string]: string;
  };
}

export interface CreateHotbarData {
  id?: string;
  name: string;
  items?: (HotbarItem | null)[];
}

export interface CreateHotbarOptions {
  setActive?: boolean;
}

export const defaultHotbarCells = 12; // Number is chosen to easy hit any item with keyboard

/** The default layout shared by hosts; identities come from the built-in catalog. */
export function createDefaultHotbarItems(
  welcome: HotbarItem["entity"],
  catalog: HotbarItem["entity"],
): (HotbarItem | null)[] {
  const items: (HotbarItem | null)[] = Array(defaultHotbarCells).fill(null);
  items[0] = { entity: welcome };
  items[1] = { entity: catalog };
  return items;
}
