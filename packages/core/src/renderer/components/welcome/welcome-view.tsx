/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./welcome.scss";

import { observer } from "mobx-react";
import { forumsUrl } from "../../../common/vars";

import type { IconProps } from "@freelensapp/icon";

import type { ReactNode } from "react";

import type { WelcomeMenuRegistration } from "./welcome-menu-items/welcome-menu-registration";

export const defaultWidth = 320;

export interface WelcomeViewProps {
  productName: string;
  menuItems: (WelcomeMenuRegistration & { disabled?: boolean; unavailableReason?: string; badge?: ReactNode })[];
  renderIcon: (props: IconProps) => ReactNode;
  introduction?: ReactNode;
  keyboardNavigation?: boolean;
}

export const WelcomeView = observer(function WelcomeView({
  productName,
  menuItems,
  renderIcon,
  introduction,
  keyboardNavigation = false,
}: WelcomeViewProps) {
  return (
    <div className="flex justify-center Welcome items-center" data-testid="welcome-page">
      <div style={{ width: `${defaultWidth}px` }} data-testid="welcome-banner-container">
        {renderIcon({
          svg: "logo-lens",
          className: "logo",
          welcomeLogo: true,
          "data-testid": "no-welcome-banners-icon",
        })}
        <div className="flex justify-center">
          <div style={{ width: `${defaultWidth}px` }} data-testid="welcome-text-container">
            <h2>{`Welcome to ${productName}!`}</h2>
            <p>
              {introduction ?? (
                <>
                  To get you started we have auto-detected your clusters in your kubeconfig file and added them to the
                  catalog, your centralized view for managing all your cloud-native resources.
                  <br />
                  <br />
                  {"If you have any questions or feedback, please join us on our "}
                  <a href={forumsUrl} target="_blank" rel="noreferrer" className="link">
                    Github repository
                  </a>
                  .
                </>
              )}
            </p>
            <ul className="block" style={{ width: `${defaultWidth}px` }} data-testid="welcome-menu-container">
              {menuItems.map((item, index) => (
                <li
                  key={index}
                  className="flex grid-12"
                  role={keyboardNavigation ? "button" : undefined}
                  tabIndex={keyboardNavigation && !item.disabled ? 0 : undefined}
                  aria-disabled={item.disabled || undefined}
                  title={item.unavailableReason}
                  onClick={item.disabled ? undefined : () => item.click()}
                  onKeyDown={(event) => {
                    if (keyboardNavigation && !item.disabled && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      item.click();
                    }
                  }}
                >
                  {renderIcon({ material: item.icon, className: "col-1" })}
                  <a className="col-10">
                    {typeof item.title === "string" ? item.title : item.title()}
                    {item.badge}
                  </a>
                  {renderIcon({ material: "navigate_next", className: "col-1" })}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
});
