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
import { useEffect } from "react";
import watchHistoryStateInjectable from "../../../remote-helpers/watch-history-state.injectable";
import toggleMaximizeWindowInjectable from "./toggle-maximize-window/toggle-maximize-window.injectable";
import topBarItemsOnLeftSideInjectable from "./top-bar-items/top-bar-items-on-left-side.injectable";
import topBarItemsOnRightSideInjectable from "./top-bar-items/top-bar-items-on-right-side.injectable";
import { TopBarView } from "./top-bar-view";

import type { IComputedValue } from "mobx";

import type { TopBarItem } from "./top-bar-items/top-bar-item-injection-token";

interface Dependencies {
  itemsOnLeft: IComputedValue<TopBarItem[]>;
  itemsOnRight: IComputedValue<TopBarItem[]>;
  toggleMaximizeWindow: () => void;
  watchHistoryState: () => () => void;
}

const NonInjectedTopBar = observer(
  ({ itemsOnLeft, itemsOnRight, toggleMaximizeWindow, watchHistoryState }: Dependencies) => {
    useEffect(() => watchHistoryState(), []);

    return (
      <TopBarView
        itemsOnLeft={itemsOnLeft.get()}
        itemsOnRight={itemsOnRight.get()}
        onDoubleClick={toggleMaximizeWindow}
      />
    );
  },
);

export const TopBar = withInjectables<Dependencies>(NonInjectedTopBar, {
  getProps: (di) => ({
    itemsOnLeft: di.inject(topBarItemsOnLeftSideInjectable),
    itemsOnRight: di.inject(topBarItemsOnRightSideInjectable),
    toggleMaximizeWindow: di.inject(toggleMaximizeWindowInjectable),
    watchHistoryState: di.inject(watchHistoryStateInjectable),
  }),
});
