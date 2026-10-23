/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { useState } from "react";
import { AvatarView } from "../../../../packages/core/src/renderer/components/avatar/avatar-view";
import { MainLayoutView } from "../../../../packages/core/src/renderer/components/layout/main-layout-view";
import sidebarStyles from "../../../../packages/core/src/renderer/components/layout/sidebar.module.scss";
import clusterStyles from "../../../../packages/core/src/renderer/components/layout/sidebar-cluster.module.scss";
import itemStyles from "../../../../packages/core/src/renderer/components/layout/sidebar-items.module.scss";
import helm from "../../../../packages/ui-components/icon/assets/helm.svg?raw";
import kube from "../../../../packages/ui-components/icon/assets/kube.svg?raw";
import nodes from "../../../../packages/ui-components/icon/assets/nodes.svg?raw";
import workloads from "../../../../packages/ui-components/icon/assets/workloads.svg?raw";
import { MaterialIconView } from "../../../../packages/ui-components/icon/src/icon-view";
import styles from "./cluster.module.scss";
import { TauriPods } from "./pods";
import { clusterSidebarItems } from "./sidebar-metadata";
import { Soon } from "./soon";

import type { CatalogSnapshot } from "../../common/tauri/protocol";
import type { PodsHost } from "./pods";

// Only these bundled SVGs enter innerHTML. Catalog DTOs never enter this map.
const icons: Record<string, string> = { kube, nodes, workloads, helm };
function SidebarIcon({ name }: { name: string }) {
  return Object.hasOwn(icons, name) ? (
    <i className="Icon svg">
      <span className="icon" dangerouslySetInnerHTML={{ __html: icons[name] }} />
    </i>
  ) : (
    <MaterialIconView material={name} aria-hidden />
  );
}

export function TauriCluster({
  entity,
  onNavigateCatalog,
  podsHost,
}: {
  entity?: CatalogSnapshot["entities"][number];
  onNavigateCatalog: () => void;
  podsHost?: PodsHost;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(["sidebar-item-workloads"]));
  const renderItems = (parentId: string | null) =>
    clusterSidebarItems
      .filter((item) => item.parentId === parentId)
      .sort((a, b) => a.order - b.order)
      .map((item) => {
        const children = clusterSidebarItems.some((child) => child.parentId === item.id);
        const active = item.id === "sidebar-item-pods";
        const activeGroup = item.id === "sidebar-item-workloads";
        const open = expanded.has(item.id);
        return (
          <div className={itemStyles.SidebarItem} key={item.id}>
            <button
              type="button"
              className={`${itemStyles.navItem} ${styles.navButton}${active || activeGroup ? " active" : ""}`}
              disabled={!children && !active}
              aria-disabled={!children && !active}
              aria-current={active ? "page" : undefined}
              aria-expanded={children ? open : undefined}
              aria-controls={children ? `${item.id}-children` : undefined}
              onClick={() =>
                children &&
                setExpanded((current) => {
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
            >
              {item.icon && <SidebarIcon name={item.icon} />}
              <span>{item.title}</span>
              {!active && <Soon />}
              {children && (
                <span className={itemStyles.expandIcon}>
                  <MaterialIconView material={open ? "expand_less" : "expand_more"} aria-hidden small />
                </span>
              )}
            </button>
            {children && (
              <div className={itemStyles.subMenu} id={`${item.id}-children`} hidden={!open}>
                {renderItems(item.id)}
              </div>
            )}
          </div>
        );
      });
  if (!entity)
    return (
      <section className={styles.missing}>
        <h1>Cluster not found</h1>
        <p>This cluster is not in the current local catalog.</p>
        <button type="button" onClick={onNavigateCatalog}>
          Back to Catalog
        </button>
      </section>
    );
  return (
    <MainLayoutView
      className={styles.cluster}
      sidebar={
        <aside className={styles.sidebar} aria-label="Cluster sidebar">
          <div className={clusterStyles.SidebarCluster}>
            <AvatarView
              title={entity.name}
              colorHash={`${entity.name}-${entity.source}`}
              size={40}
              className={clusterStyles.avatar}
            />
            <div className={clusterStyles.clusterName}>{entity.name}</div>
          </div>
          <button type="button" className={styles.back} onClick={onNavigateCatalog}>
            Back to Catalog
          </button>
          <nav className={sidebarStyles.sidebarNav} aria-label="Cluster navigation">
            {renderItems(null)}
          </nav>
        </aside>
      }
    >
      <TauriPods clusterId={entity.id} host={podsHost} />
    </MainLayoutView>
  );
}
