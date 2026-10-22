/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import statusBarCurrentStatusInjectable from "./current-status.injectable";
import statusBarItemsInjectable from "./status-bar-items.injectable";
import { StatusBarView } from "./status-bar-view";

import type { IComputedValue, IObservableValue } from "mobx";

import type { StatusBarStatus } from "./current-status.injectable";
import type { StatusBarItems } from "./status-bar-items.injectable";

export interface StatusBarProps {}

interface Dependencies {
  items: IComputedValue<StatusBarItems>;
  status: IObservableValue<StatusBarStatus>;
}

const NonInjectedStatusBar = observer(({ items, status }: Dependencies & StatusBarProps) => {
  return <StatusBarView items={items.get()} status={status.get()} />;
});

export const StatusBar = withInjectables<Dependencies, StatusBarProps>(NonInjectedStatusBar, {
  getProps: (di, props) => ({
    ...props,
    items: di.inject(statusBarItemsInjectable),
    status: di.inject(statusBarCurrentStatusInjectable),
  }),
});
