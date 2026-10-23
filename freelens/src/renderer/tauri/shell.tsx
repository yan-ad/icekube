/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useEffect, useRef, useState } from "react";
import { ClusterManagerView } from "../../../../packages/core/src/renderer/components/cluster-manager/cluster-manager-view";
import { HotbarCell } from "../../../../packages/core/src/renderer/components/hotbar/hotbar-cell";
import { HotbarIconView } from "../../../../packages/core/src/renderer/components/hotbar/hotbar-icon-view";
import { HotbarMenuView } from "../../../../packages/core/src/renderer/components/hotbar/hotbar-menu-view";
import selectorStyles from "../../../../packages/core/src/renderer/components/hotbar/hotbar-selector.module.scss";
import topBarStyles from "../../../../packages/core/src/renderer/components/layout/top-bar/top-bar.module.scss";
import { TopBarView } from "../../../../packages/core/src/renderer/components/layout/top-bar/top-bar-view";
import { StatusBarView } from "../../../../packages/core/src/renderer/components/status-bar/status-bar-view";
import { CatalogAction, CatalogActions } from "./catalog-controls";
import styles from "./shell.module.scss";
import { Soon } from "./soon";

import type { ReactNode } from "react";

import type { CatalogSnapshot } from "../../common/tauri/protocol";
import type { CatalogHotbar } from "./hotbar";

export interface TauriShellProps {
  children: ReactNode;
  catalog?: CatalogSnapshot;
  hotbar: CatalogHotbar;
  onRunEntity: (id: string) => void;
  onNavigateHome: () => void;
  onDragWindow?: () => void;
  onToggleMaximize?: () => void;
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
        <Soon />
      </div>
    </div>
  );
}

/**
 * Shared Freelens launcher chrome, not a replacement application design.
 * Catalog/Preferences are catalog entities in Electron, not extra topbar buttons.
 * No hotbar profile or status items are invented for this host.
 */
export function TauriShell({
  children,
  onNavigateHome,
  catalog,
  hotbar,
  onRunEntity,
  onDragWindow,
  onToggleMaximize,
}: TauriShellProps) {
  const { canGoBack, canGoForward } = useLauncherHistory();
  const isMac = /Mac/.test(window.navigator.platform);
  const atHome = window.location.hash === "" || window.location.hash === "#/welcome";

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
      topBar={
        <TopBarView
          itemsOnLeft={itemsOnLeft}
          itemsOnRight={[]}
          onDoubleClick={(event) => {
            if (!(event.target as HTMLElement).closest("button, [role='button'], input, a")) onToggleMaximize?.();
          }}
          onMouseDown={(event) => {
            if (
              event.button === 0 &&
              event.detail === 1 &&
              !(event.target as HTMLElement).closest("button, [role='button'], input, a")
            )
              onDragWindow?.();
          }}
        />
      }
      hotbar={
        <HotbarMenuView
          selector={
            <div className={selectorStyles.HotbarSelector}>
              <span className={styles.unavailable} aria-disabled="true" title={unavailable}>
                ◂
              </span>
              <div className={selectorStyles.HotbarIndex}>
                <span
                  className={`${selectorStyles.Badge} ${styles.unavailable}`}
                  aria-disabled="true"
                  title={`Default · Hotbar switching: ${unavailable}`}
                >
                  1
                  <Soon title="Hotbar switching is not implemented in Tauri yet." />
                </span>
              </div>
              <span className={styles.unavailable} aria-disabled="true" title={unavailable}>
                ▸
              </span>
            </div>
          }
        >
          {hotbar.items.map((item, index) => {
            const entity = catalog?.entities.find((entry) => entry.id === item?.entity.uid);
            return (
              <HotbarCell key={index} index={index}>
                {item && (
                  <CatalogActions
                    label={`Hotbar actions for ${entity?.name ?? item.entity.name}`}
                    contextTrigger={
                      <div
                        role="button"
                        aria-label={entity?.name ?? item.entity.name}
                        aria-disabled={!entity || undefined}
                        tabIndex={entity ? 0 : -1}
                        title={
                          entity ? `${entity.name} (${entity.source})` : `${item.entity.name} · Not in current catalog`
                        }
                        onKeyDown={(event) => {
                          if (entity && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            onRunEntity(entity.id);
                          }
                        }}
                      >
                        <HotbarIconView
                          uid={item.entity.uid}
                          title={entity?.name ?? item.entity.name}
                          source={entity?.source ?? item.entity.source}
                          background={entity?.icon?.background}
                          disabled={!entity}
                          active={
                            entity?.action ===
                              (atHome ? "welcome" : window.location.hash === "#/catalog" ? "catalog" : undefined) ||
                            window.location.hash === `#/cluster/${encodeURIComponent(entity?.id ?? "")}`
                          }
                          onClick={() => entity && onRunEntity(entity.id)}
                          materialIcon={
                            entity?.icon?.material ? (
                              <i className="Icon material" aria-hidden>
                                <span className="icon">{entity.icon.material}</span>
                              </i>
                            ) : undefined
                          }
                        />
                      </div>
                    }
                  >
                    <CatalogAction onClick={() => hotbar.remove(item.entity.uid)}>Remove from Hotbar</CatalogAction>
                  </CatalogActions>
                )}
              </HotbarCell>
            );
          })}
        </HotbarMenuView>
      }
      statusBar={
        <StatusBarView
          items={{
            left: [
              {
                origin: "tauri",
                component: () => (
                  <span title="Terminals, cluster activation, hotbar switching, settings badges, and extensions are not available yet. Your existing Freelens profile has not been opened.">
                    Read-only development · Pins: session only
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
      {hotbar.message && (
        <div role="status" className={styles.hotbarMessage}>
          {hotbar.message}
        </div>
      )}
      {children}
    </ClusterManagerView>
  );
}
