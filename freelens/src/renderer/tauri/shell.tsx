/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useRef, useState } from "react";
import { ClusterManagerView } from "../../../../packages/core/src/renderer/components/cluster-manager/cluster-manager-view";
import { HotbarMenuView } from "../../../../packages/core/src/renderer/components/hotbar/hotbar-menu-view";
import topBarStyles from "../../../../packages/core/src/renderer/components/layout/top-bar/top-bar.module.scss";
import { TopBarView } from "../../../../packages/core/src/renderer/components/layout/top-bar/top-bar-view";
import { StatusBarView } from "../../../../packages/core/src/renderer/components/status-bar/status-bar-view";
import styles from "./shell.module.scss";

import type { ReactNode } from "react";

export interface TauriShellProps {
  children: ReactNode;
  onNavigateHome: () => void;
}

const historyKey = "freelensTauriLauncherIndex";
const unavailable = "Not available in Tauri yet";

/** Track actual hash-history entries in this window, not a second simulated navigation stack. */
function useLauncherHistory() {
  const [index, setIndex] = useState(0);
  const [lastIndex, setLastIndex] = useState(0);
  const currentIndex = useRef(0);

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, [historyKey]: 0 }, "");

    const onNavigation = () => {
      const savedIndex = window.history.state?.[historyKey];
      if (typeof savedIndex === "number") {
        currentIndex.current = savedIndex;
        setIndex(savedIndex);
      } else {
        const nextIndex = currentIndex.current + 1;
        window.history.replaceState({ ...window.history.state, [historyKey]: nextIndex }, "");
        currentIndex.current = nextIndex;
        setIndex(nextIndex);
        setLastIndex(nextIndex);
      }
    };

    window.addEventListener("popstate", onNavigation);
    window.addEventListener("hashchange", onNavigation);
    return () => {
      window.removeEventListener("popstate", onNavigation);
      window.removeEventListener("hashchange", onNavigation);
    };
  }, []);

  return { canGoBack: index > 0, canGoForward: index < lastIndex };
}

/** Narrow browser-only rendering of the original material Icon classes. */
function NavigationIcon({
  material,
  label,
  testId,
  disabled,
  onClick,
}: {
  material: string;
  label: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <i
      className={`Icon material interactive focusable${disabled ? " disabled" : ""}`}
      role="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={label}
      tabIndex={disabled ? -1 : 0}
      data-testid={testId}
      onClick={disabled ? undefined : onClick}
      onKeyDown={
        disabled
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
      }
    >
      <span className="icon" data-icon-name={material} aria-hidden>
        {material}
      </span>
    </i>
  );
}

function UnavailableApplicationMenu() {
  return (
    <div className={topBarStyles.winMenu}>
      <div
        className={styles.unavailable}
        role="button"
        aria-disabled="true"
        title={unavailable}
        data-testid="window-menu"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
          <path fill="currentColor" d="M0,8.5h12v1H0V8.5z" />
          <path fill="currentColor" d="M0,5.5h12v1H0V5.5z" />
          <path fill="currentColor" d="M0,2.5h12v1H0V2.5z" />
        </svg>
      </div>
    </div>
  );
}

/**
 * Shared Freelens launcher chrome, not a replacement application design.
 * Catalog/Preferences are catalog entities in Electron, not extra topbar buttons.
 * No hotbar profile or status items are invented for this host.
 */
export function TauriShell({ children, onNavigateHome }: TauriShellProps) {
  const { canGoBack, canGoForward } = useLauncherHistory();
  const isMac = /Mac/.test(window.navigator.platform);
  const atHome = window.location.hash !== "#/catalog";

  // Original built-in registration priorities: menu 10 (non-mac), home 20,
  // back 30, forward 40. Native decorations already supply window controls.
  const itemsOnLeft = [
    ...(!isMac ? [{ id: "context-menu", Component: UnavailableApplicationMenu }] : []),
    {
      id: "navigation-to-home",
      Component: () => (
        <NavigationIcon material="home" label="Home" testId="home-button" disabled={atHome} onClick={onNavigateHome} />
      ),
    },
    {
      id: "navigation-to-back",
      Component: () => (
        <NavigationIcon
          material="arrow_back"
          label="Back"
          testId="history-back"
          disabled={!canGoBack}
          onClick={() => window.history.back()}
        />
      ),
    },
    {
      id: "navigation-to-forward",
      Component: () => (
        <NavigationIcon
          material="arrow_forward"
          label="Forward"
          testId="history-forward"
          disabled={!canGoForward}
          onClick={() => window.history.forward()}
        />
      ),
    },
  ];

  return (
    <ClusterManagerView
      className={styles.shell}
      topBar={<TopBarView itemsOnLeft={itemsOnLeft} itemsOnRight={[]} />}
      hotbar={<HotbarMenuView />}
      statusBar={
        <StatusBarView
          items={{
            left: [
              {
                origin: "tauri",
                component: () => (
                  <span title="Cluster discovery, catalog actions, terminals, hotbar persistence, and extensions are not connected yet. Your existing Freelens profile has not been opened.">
                    Tauri development · Built-in catalog only · Read-only
                  </span>
                ),
              },
            ],
            right: [],
          }}
        />
      }
      lensViews={null}
    >
      {children}
    </ClusterManagerView>
  );
}
