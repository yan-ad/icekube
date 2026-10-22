/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { useEffect } from "react";
import productNameInjectable from "../../../common/vars/product-name.injectable";
import newVersionNotificationInjectable from "./new-version-notification.injectable";
import welcomeMenuItemsInjectable from "./welcome-menu-items/welcome-menu-items.injectable";
import { WelcomeView } from "./welcome-view";

import type { IComputedValue } from "mobx";

import type { WelcomeMenuRegistration } from "./welcome-menu-items/welcome-menu-registration";

export { defaultWidth } from "./welcome-view";

interface Dependencies {
  welcomeMenuItems: IComputedValue<WelcomeMenuRegistration[]>;
  productName: string;
  newVersionNotification: () => Promise<void> | void;
}

const NonInjectedWelcome = observer(({ welcomeMenuItems, productName, newVersionNotification }: Dependencies) => {
  useEffect(() => {
    newVersionNotification();
  }, []);

  return (
    <WelcomeView
      productName={productName}
      menuItems={welcomeMenuItems.get()}
      renderIcon={(props) => <Icon {...props} />}
    />
  );
});

export const Welcome = withInjectables<Dependencies>(NonInjectedWelcome, {
  getProps: (di) => ({
    welcomeMenuItems: di.inject(welcomeMenuItemsInjectable),
    productName: di.inject(productNameInjectable),
    newVersionNotification: di.inject(newVersionNotificationInjectable),
  }),
});
