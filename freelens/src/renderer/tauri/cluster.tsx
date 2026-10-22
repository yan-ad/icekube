/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "../../../../packages/core/src/renderer/components/cluster-manager/cluster-view.scss";
import { ClusterStatusView } from "../../../../packages/core/src/renderer/components/cluster-manager/cluster-status-view";
import styles from "./cluster.module.scss";
import { Soon } from "./soon";

import type { CatalogSnapshot } from "../../common/tauri/protocol";

export function TauriCluster({
  entity,
  onNavigateCatalog,
}: {
  entity?: CatalogSnapshot["entities"][number];
  onNavigateCatalog: () => void;
}) {
  return (
    <section className={`ClusterView flex flex-col items-center ${styles.cluster}`} aria-label="Cluster connection">
      <ClusterStatusView
        name={entity?.name ?? "Cluster not found"}
        status={
          <p role="status">
            {entity ? (
              <>
                Cluster connection <Soon />
              </>
            ) : (
              "This cluster is not in the current local catalog."
            )}
          </p>
        }
        output={
          entity && (
            <pre>
              No connection has been started.{"\n"}Authentication plugins and the Kubernetes proxy are not ported yet.
            </pre>
          )
        }
        help={
          <div className={styles.actions}>
            {entity && (
              <>
                <button type="button" disabled title="Authentication and proxy lifecycle are not ported yet.">
                  Connect <Soon />
                </button>
                <button type="button" disabled title="Cluster settings are not ported yet.">
                  Settings <Soon />
                </button>
              </>
            )}
            <button type="button" onClick={onNavigateCatalog}>
              Back to Catalog
            </button>
          </div>
        }
      />
    </section>
  );
}
